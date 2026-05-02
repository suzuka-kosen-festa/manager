REPO_ROOT     := $(CURDIR)
TERRAFORM_DIR := /workspace/terraform
TF_IMAGE      := hashicorp/terraform:latest

.PHONY: init test plan apply security

init:
	docker run --rm \
	  -v $(REPO_ROOT):/workspace \
	  -w $(TERRAFORM_DIR) \
	  $(TF_IMAGE) init

test:
	docker run --rm \
	  -v $(REPO_ROOT):/workspace \
	  -w $(TERRAFORM_DIR) \
	  $(TF_IMAGE) fmt -check -recursive
	docker run --rm \
	  -v $(REPO_ROOT):/workspace \
	  -w $(TERRAFORM_DIR) \
	  $(TF_IMAGE) validate

plan: init
	docker run --rm \
	  -v $(REPO_ROOT):/workspace \
	  -w $(TERRAFORM_DIR) \
	  $(TF_IMAGE) plan

apply: init
	docker run --rm \
	  -v $(REPO_ROOT):/workspace \
	  -w $(TERRAFORM_DIR) \
	  $(TF_IMAGE) apply

security:
	@echo "==> tflint"
	docker run --rm \
	  -v $(REPO_ROOT):/workspace \
	  --entrypoint sh \
	  ghcr.io/terraform-linters/tflint \
	  -c "cd $(TERRAFORM_DIR) && tflint --init && tflint"
	@echo "==> tfsec"
	docker run --rm \
	  -v $(REPO_ROOT):/workspace \
	  aquasec/tfsec $(TERRAFORM_DIR)
	@echo "==> checkov"
	docker run --rm \
	  -v $(REPO_ROOT):/workspace \
	  bridgecrew/checkov \
	  -d $(TERRAFORM_DIR) --framework terraform
	@echo "==> trivy"
	docker run --rm \
	  -v $(REPO_ROOT):/workspace \
	  ghcr.io/aquasecurity/trivy config $(TERRAFORM_DIR)
