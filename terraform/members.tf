locals {
  members_csv_path = "${path.module}/../manager-data/members.csv"

  members = {
    for row in csvdecode(file(local.members_csv_path)) :
    trimspace(row.username) => lower(trimspace(row.role))
    if trimspace(try(row.username, "")) != ""
  }
}

resource "github_membership" "members" {
  for_each = local.members

  username = each.key
  role     = each.value

  lifecycle {
    ignore_changes = [etag]
  }
}
