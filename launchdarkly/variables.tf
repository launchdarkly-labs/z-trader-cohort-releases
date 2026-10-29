variable "launchdarkly_access_token" {
  description = "LaunchDarkly REST API access token. Supply via the LAUNCHDARKLY_ACCESS_TOKEN env var — do not put it in a committed tfvars file."
  type        = string
  sensitive   = true
  default     = null
}

variable "project_key" {
  description = "LaunchDarkly project key this demo is deployed into. No default on purpose — a customer points this at their own project."
  type        = string
}

variable "environment_key" {
  description = "LaunchDarkly environment key within the project (e.g. production, test)."
  type        = string
  default     = "production"
}

variable "tags" {
  description = "Tags applied to every object created here. Keep \"demo\" so demo objects stay easy to find and sweep."
  type        = list(string)
  default     = ["demo"]
}
