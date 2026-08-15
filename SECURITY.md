# Security Policy

## Supported versions

Only the latest release is supported during the developer-preview phase.

## Reporting

Please report suspected vulnerabilities privately to the maintainers before opening a public issue. Do not include API keys, model credentials, DSH configuration, or user data in reports.

## Security model

DSH Desktop loads only the configured local DSH origin. Node integration is disabled; context isolation and Chromium sandboxing are enabled. External URLs open in the system browser. The desktop shell does not expose process-launch or filesystem IPC to the loaded page.

Custom launch commands are trusted local configuration. Users should not copy configuration from untrusted sources.
