REPO_ROOT     := $(CURDIR)
TERRAFORM_DIR := $(CURDIR)/terraform
MISE          := mise exec --

.PHONY: init test plan apply security

init:
	cd $(TERRAFORM_DIR) && $(MISE) terraform init

test:
	cd $(TERRAFORM_DIR) && $(MISE) terraform fmt -check -recursive
	cd $(TERRAFORM_DIR) && $(MISE) terraform validate

plan: init
	cd $(TERRAFORM_DIR) && $(MISE) terraform plan

apply: init
	cd $(TERRAFORM_DIR) && $(MISE) terraform apply

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
