TERRAFORM_DIR := $(CURDIR)/terraform
TF_IMAGE      := hashicorp/terraform:latest

.PHONY: init test plan apply security

init:
	docker run --rm \
	  -v $(TERRAFORM_DIR):/workspace \
	  -w /workspace \
	  $(TF_IMAGE) init

test:
	docker run --rm \
	  -v $(TERRAFORM_DIR):/workspace \
	  -w /workspace \
	  $(TF_IMAGE) fmt -check -recursive
	docker run --rm \
	  -v $(TERRAFORM_DIR):/workspace \
	  -w /workspace \
	  $(TF_IMAGE) validate

plan: init
	docker run --rm \
	  -v $(TERRAFORM_DIR):/workspace \
	  -w /workspace \
	  $(TF_IMAGE) plan

apply: init
	docker run --rm \
	  -v $(TERRAFORM_DIR):/workspace \
	  -w /workspace \
	  $(TF_IMAGE) apply

security:
	@echo "==> tflint"
	docker run --rm \
	  -v $(TERRAFORM_DIR):/data \
	  -w /data \
	  --entrypoint sh \
	  ghcr.io/terraform-linters/tflint \
	  -c "tflint --init && tflint"
	@echo "==> tfsec"
	docker run --rm \
	  -v $(TERRAFORM_DIR):/src \
	  aquasec/tfsec /src
	@echo "==> checkov"
	docker run --rm \
	  -v $(TERRAFORM_DIR):/tf \
	  bridgecrew/checkov \
	  -d /tf --framework terraform
	@echo "==> trivy"
	docker run --rm \
	  -v $(TERRAFORM_DIR):/src \
	  ghcr.io/aquasecurity/trivy config /src
