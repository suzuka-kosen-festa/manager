locals {
  members = {
    # GitHub username = role ("member" or "admin")
    # 例:
    # "octocat" = "member"
    # "admin-user" = "admin"
  }
}

resource "github_membership" "members" {
  for_each = local.members

  username = each.key
  role     = each.value
}
