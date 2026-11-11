# Vite + CopilotKit on ECS behind CloudFront

This repository contains:

- **`apps/frontend`**: a Vite + React app that uses CopilotKit's chat UI. In production a small Node.js (Express) server serves the built files.
- **`apps/backend`**: a Node.js CopilotKit runtime. It forwards each chat run to an existing **Amazon Bedrock AgentCore** runtime, whose ARN comes from the `AGENTCORE_AGENT_ARN` environment variable.
- **`infra`**: Terraform that runs both apps as ECS Fargate tasks behind one CloudFront distribution.

## How the pieces connect

```
Browser ──HTTPS──> CloudFront (one hostname)
                     │  /api, /api/*   → no caching, all methods
                     │  /assets/*      → cached
                     │  everything else→ no caching
                     ▼  (adds a secret X-Origin-Verify header)
                   Application Load Balancer (accepts CloudFront IPs only)
                     │  /api, /api/* + secret header → backend target group  (port 3001)
                     │  /*           + secret header → frontend target group (port 3000)
                     ▼
                   ECS Fargate tasks in private subnets
                     backend ──InvokeAgentRuntime (IAM task role)──> AgentCore runtime
```

The frontend and backend reach each other only through CloudFront paths. The browser loads the page from `https://<distribution>/` and calls the CopilotKit runtime at `https://<distribution>/api/copilotkit` on the same origin, so no CORS setup is needed. In local development, Vite's dev server proxies `/api` to the backend in the same way.

The backend signs AgentCore calls with the ECS task role. No AWS credentials reach the browser.

## Requirements for the AgentCore agent

This stack does **not** create the agent. You need an agent that is already deployed in AgentCore Runtime and that:

1. Uses the **AG-UI protocol** (for example `agentcore configure -e my_agent.py --protocol AGUI`). The backend sends the AG-UI `RunAgentInput` JSON and expects an AG-UI `text/event-stream` response.
2. Uses **IAM (SigV4) inbound authentication**. The AWS SDK cannot call agents configured for OAuth/JWT inbound auth.
3. Lives in the **same region** as this deployment (`aws_region`). Terraform and the backend both check this.

The ARN looks like `arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/my_agent-AbCdEf1234`. Find it with:

```bash
aws bedrock-agentcore-control list-agent-runtimes --region us-east-1
```

Each CopilotKit thread maps to a stable AgentCore session ID (a SHA-256 of the thread ID), so one conversation stays in one AgentCore session.

## Tools you need

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js + npm | Node 22.12 or newer | Local development, tests, builds |
| Docker (with `buildx`) | recent | Building the container images |
| AWS CLI | v2 | ECR login, logs, finding the agent ARN |
| Terraform | 1.7 or newer | Infrastructure |

Your AWS identity needs permission to create VPC, ECS, ECR, IAM, ELB, CloudWatch Logs, and CloudFront resources.

## Repository layout

```
.
├── package.json              # npm workspaces + root scripts
├── .env.example              # local backend settings
├── apps/
│   ├── frontend/
│   │   ├── src/main.tsx      # CopilotKit provider + chat UI
│   │   ├── vite.config.ts    # dev proxy: /api -> http://127.0.0.1:3001
│   │   ├── server.mjs        # production static server (port 3000)
│   │   └── Dockerfile
│   └── backend/
│       ├── src/config.ts     # environment validation
│       ├── src/agent.ts      # AG-UI agent that calls AgentCore
│       ├── src/app.ts        # Express + CopilotKit runtime (/api/copilotkit)
│       └── Dockerfile
└── infra/                    # Terraform (VPC, ECR, ECS, ALB, CloudFront, IAM)
```

## 1. Run locally

### 1.1 Install dependencies

```bash
npm install
cp .env.example .env
```

### 1.2 Start with the mock agent (no AWS needed)

`.env.example` sets `AGENT_MODE=mock`. The mock agent streams a fixed AG-UI reply so you can check the UI and the runtime wiring.

```bash
npm run dev
```

This starts:

- the backend on `http://localhost:3001` (CopilotKit runtime at `/api/copilotkit`, health check at `/api/healthz`)
- the Vite dev server on `http://localhost:5173`, which proxies `/api` to the backend

Open http://localhost:5173 and send a message. You should see the mock reply.

Quick checks from another terminal:

```bash
curl http://localhost:5173/api/healthz
# {"status":"ok","mode":"mock"}
```

### 1.3 Talk to your real AgentCore agent locally

Edit `.env`:

```dotenv
AGENT_MODE=agentcore
AWS_REGION=us-east-1
AGENTCORE_AGENT_ARN=arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/my_agent-AbCdEf1234
AGENTCORE_QUALIFIER=DEFAULT
AWS_PROFILE=my-profile   # or export AWS credentials in your shell
COPILOTKIT_TELEMETRY_DISABLED=true
```

Your local AWS identity needs `bedrock-agentcore:InvokeAgentRuntime` on the agent. Then run `npm run dev` again.

### Backend environment variables

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `AGENT_MODE` | no | `agentcore` | `agentcore` or `mock`. Mock is refused when `NODE_ENV=production`. |
| `AGENTCORE_AGENT_ARN` | in `agentcore` mode | none | AgentCore runtime ARN. The backend will not start without a valid one. |
| `AWS_REGION` | no | region from the ARN | Must match the ARN's region. |
| `AGENTCORE_QUALIFIER` | no | `DEFAULT` | AgentCore endpoint name. |
| `PORT` | no | `3001` | Listening port. |
| `COPILOTKIT_TELEMETRY_DISABLED` | no | unset | Set to `true` to turn off CopilotKit telemetry. |

## 2. Test and build

```bash
npm run typecheck   # TypeScript checks for both apps
npm test            # builds both apps, then runs backend and frontend tests
npm run build       # production builds only
```

Backend tests cover configuration validation, session ID mapping, the AgentCore request shape and streaming, and full runs through the real CopilotKit HTTP endpoint using the mock agent. The frontend test checks the production server (SPA routing, asset caching, and that `/api` paths never return the HTML page).

Terraform tests use mocked AWS providers, so they need no AWS account:

```bash
cd infra
terraform init -backend=false
terraform validate
terraform test
```

### Optional: run the production containers locally

```bash
docker build -f apps/frontend/Dockerfile -t simpleecs-frontend .
docker build -f apps/backend/Dockerfile  -t simpleecs-backend .

docker run --rm -p 3000:3000 simpleecs-frontend
docker run --rm -p 3001:3001 \
  -e AGENTCORE_AGENT_ARN=arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/my_agent-AbCdEf1234 \
  -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN \
  simpleecs-backend
```

Build both images from the repository root, because they use the root `package-lock.json`. Run them separately like this to check that they start. In AWS, CloudFront joins them under one hostname.

## 3. Deploy to AWS

ECS cannot start tasks until the images exist in ECR, and the ECR repositories are created by Terraform. Deployment therefore has two Terraform passes: first create everything with zero tasks, then push images, then turn the services on.

### 3.1 Configure Terraform

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
aws_region          = "us-east-1"
project_name        = "simpleecs"
agentcore_agent_arn = "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/my_agent-AbCdEf1234"
agentcore_qualifier = "DEFAULT"
image_tag           = "v1"
services_enabled    = false
desired_count       = 1
```

| Variable | Meaning |
| --- | --- |
| `aws_region` | Region for everything. Must match the agent ARN. |
| `project_name` | Prefix for resource names (3–20 lowercase letters, digits, hyphens). |
| `agentcore_agent_arn` | Passed to the backend task as `AGENTCORE_AGENT_ARN`. The backend task role may invoke only this runtime. |
| `agentcore_qualifier` | AgentCore endpoint name. |
| `image_tag` | Tag used for both images. ECR tags are immutable, so use a new tag for every release. |
| `services_enabled` | `false` creates services with 0 tasks; `true` runs `desired_count` tasks of each app. |
| `desired_count` | Tasks per service when enabled. |
| `vpc_cidr` | VPC range (default `10.42.0.0/16`). |

For shared or production use, configure a remote state backend (for example S3 with encryption) before the first apply. The state contains the secret CloudFront header value.

### 3.2 First apply (infrastructure, no tasks)

```bash
terraform init
terraform apply
```

This creates the VPC (2 public and 2 private subnets, one NAT gateway), ECR repositories, the ECS cluster, task definitions, services with 0 tasks, the ALB, the CloudFront distribution, IAM roles, and log groups. CloudFront can take 5–15 minutes.

Save the outputs:

```bash
terraform output
export AWS_REGION=$(terraform console <<< 'var.aws_region' | tr -d '"')
export FRONTEND_REPO=$(terraform output -json ecr_repository_urls | jq -r .frontend)
export BACKEND_REPO=$(terraform output -json ecr_repository_urls | jq -r .backend)
export REGISTRY=${BACKEND_REPO%%/*}
```

(If you do not have `jq`, copy the two URLs from `terraform output ecr_repository_urls` by hand.)

### 3.3 Build and push the images

Run from the repository root. The task definitions use `X86_64`, so build for `linux/amd64` (this matters on Apple Silicon).

```bash
cd ..
TAG=v1   # must equal image_tag in terraform.tfvars

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

docker buildx build --platform linux/amd64 -f apps/frontend/Dockerfile \
  -t "$FRONTEND_REPO:$TAG" --push .
docker buildx build --platform linux/amd64 -f apps/backend/Dockerfile \
  -t "$BACKEND_REPO:$TAG" --push .
```

### 3.4 Second apply (start the tasks)

Set `services_enabled = true` in `terraform.tfvars`, then:

```bash
cd infra
terraform apply
```

Terraform waits until both services are stable. If the containers fail their health checks, the ECS deployment circuit breaker rolls back and the apply reports an error.

### 3.5 Open the app

```bash
terraform output -raw cloudfront_url
```

Open the URL and chat. Check the backend through CloudFront:

```bash
curl "$(terraform output -raw cloudfront_url)/api/healthz"
# {"status":"ok","mode":"agentcore"}
```

## 4. Release a new version

```bash
TAG=v2
docker buildx build --platform linux/amd64 -f apps/frontend/Dockerfile -t "$FRONTEND_REPO:$TAG" --push .
docker buildx build --platform linux/amd64 -f apps/backend/Dockerfile  -t "$BACKEND_REPO:$TAG"  --push .
cd infra && terraform apply -var image_tag=$TAG
```

Also update `image_tag` in `terraform.tfvars` so later applies do not roll back. ECS does a rolling deployment with no downtime. HTML is served with `no-store` and built assets have hashed names, so you do not need a CloudFront invalidation.

To point at a different agent, change `agentcore_agent_arn` and run `terraform apply`. ECS rolls out a new backend task definition.

## 5. Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `Forbidden` (403) from the ALB DNS name | Expected. The ALB only forwards requests that come through CloudFront with the secret header. Use the CloudFront URL. |
| 502/503 from CloudFront right after deploy | Tasks are still starting or failing health checks. Check `aws ecs describe-services --cluster simpleecs --services simpleecs-backend simpleecs-frontend` and the logs. |
| Chat shows an error; backend logs show `AgentCore invocation failed { name: 'AccessDeniedException' }` | Wrong ARN or qualifier, or the agent uses OAuth inbound auth instead of IAM. |
| Logs show `ResourceNotFoundException` | The ARN or region is wrong, or the qualifier endpoint does not exist. |
| Error about `text/event-stream` | The agent is not using the AG-UI protocol. Redeploy it with `--protocol AGUI`. |
| Backend task exits at startup | `AGENTCORE_AGENT_ARN` is invalid or its region differs from `AWS_REGION`. The error is in the backend log. |
| `CannotPullContainerError` | The image tag in `image_tag` was not pushed to ECR. |

View logs:

```bash
aws logs tail /ecs/simpleecs/backend --follow --region "$AWS_REGION"
aws logs tail /ecs/simpleecs/frontend --follow --region "$AWS_REGION"
```

The backend logs only error names, never prompts, responses, or credentials.

## 6. Tear down

ECR repositories are protected from deletion while they contain images. Delete the images first, then destroy:

```bash
for repo in simpleecs/frontend simpleecs/backend; do
  ids=$(aws ecr list-images --repository-name "$repo" --region "$AWS_REGION" --query 'imageIds' --output json)
  [ "$ids" != "[]" ] && aws ecr batch-delete-image --repository-name "$repo" --region "$AWS_REGION" --image-ids "$ids"
done
cd infra && terraform destroy
```

## Before using this in production

- **There is no user sign-in.** Anyone with the CloudFront URL can chat with the agent and spend your AgentCore and model budget. Add authentication (for example Cognito with an ALB or CloudFront-level check, or a check in the backend) and consider AWS WAF rate limiting on the distribution.
- The default CloudFront certificate is used. For a custom domain, add an ACM certificate in `us-east-1` and `aliases` to the distribution.
- Traffic between CloudFront and the ALB is HTTP inside AWS's network, protected by the CloudFront-only security group and the secret header. For end-to-end TLS, add an HTTPS listener with your own certificate and switch the origin to `https-only`.
- There is one NAT gateway to keep costs down. Use one per Availability Zone for higher availability.
- CloudFront's origin read timeout is 60 seconds. This is the longest gap allowed between streamed bytes, not the total run time. An agent that stays silent for more than 60 seconds will be cut off.
