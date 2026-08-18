# Security Policy

## Supported Version

Security fixes are applied to the current `main` branch and the deployment at [music.grinningfrog.com](https://music.grinningfrog.com/).

## Security Model

Grinning Frog Sequencer is a static browser application with no application backend in this repository.

- Song state and provider settings are stored in the browser.
- OpenAI and Anthropic requests go directly from the browser to the provider selected by the user.
- Ollama requests go to the locally configured Ollama endpoint.
- Provider keys are never required for the core sequencer or local patching features.

Because browser storage is readable by code running on the same origin, users should use scoped, revocable API keys and should not enter sensitive keys on shared or untrusted devices. Clearing site data removes locally stored provider settings.

## Reporting a Vulnerability

Please do not place API keys, tokens, exploit details, or other sensitive data in a public issue.

Report security concerns privately through GitHub's security-advisory flow when available. Otherwise, contact the repository owner through the GitHub profile and include only enough information to establish a private reporting channel.
