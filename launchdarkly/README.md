# LaunchDarkly configuration (Terraform)

All LaunchDarkly configuration for this demo that the provider can express —
segments, flags, targeting, metrics — is declared here as Terraform, so the demo
can be rebuilt or torn down in one command and a customer can apply it to their
own account.

Two objects are created by `../scripts/` because provider 2.x has no resource
for them: the `device` context kind (and its availability for experiments and
guarded rollouts) and the release policy. The audience-based release and the
experiment are started in the UI (see `../runbook.md`).

## Usage

```sh
export LAUNCHDARKLY_ACCESS_TOKEN=api-...   # never committed (or put it in ../.env)
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars                   # set project_key / environment_key

terraform init
terraform plan                             # always review before applying
terraform apply
```

Or run `../scripts/bootstrap.sh` (plan) then `../scripts/bootstrap.sh --apply`,
which also handles the context kind and release policy and reads `../.env`.

Tear down after the demo (stop any running release/experiment first):

```sh
terraform destroy
```

## Files

| File | Contents |
| --- | --- |
| `main.tf` | Terraform + provider block (pinned `~> 2.0`) |
| `segments.tf` | `ios-18-plus`, `ios-17`, `ios-16-and-older` on context kind `device` with semVer clauses |
| `flags.tf` | `dark-mode` (3 rules + off default), `dark-mode-contrast`, three Option A flags |
| `metrics.tf` | `render-error`, `screen-load-ms`, `order-placed`, all randomised on `device` |
| `variables.tf` / `outputs.tf` | Portable inputs; `flag_keys` output is the archive list |

## Notes

- `dark-mode` and `dark-mode-contrast` targeting has `lifecycle { ignore_changes = [rules] }`
  so Terraform never fights a live release or experiment. Comment it out and
  `apply` to force a reset to the beat-1 rules.
- semVer `>= X` is written as `semVerLessThan X` with `negate = true`.
- Segment-match clauses use `attribute = "segmentMatch"`, `op = "segmentMatch"`.

## Portability

`project_key` and `environment_key` are required variables with no
account-specific defaults. To run this demo against a different account, change
`terraform.tfvars` and re-apply — no edits to `.tf` files needed.

## Conventions

- Every object carries the `demo` tag (via `var.tags`); Option A flags add `option-a`, the experiment flag adds `experiment`.
- Demo flags are `temporary = true` so they surface in stale-flag views.
- `.terraform.lock.hcl` is committed (provider 2.30.4, hashes for `darwin_arm64`, `darwin_amd64`, `linux_amd64`). To add a platform or bump the provider:

  ```sh
  terraform providers lock -platform=<os_arch>
  terraform init -upgrade
  ```

## State

`*.tfstate` is gitignored. State is local by default, which is fine for
throwaway demos.
