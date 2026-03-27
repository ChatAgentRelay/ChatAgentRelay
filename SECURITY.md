# Security

Chat Agent Relay (CAR) is **pre-v1 software**. Interfaces, behavior, and security posture may change without notice. Reports are still welcome and help improve the project.

## How to report a vulnerability

Send email to **security@openclaw.dev** (placeholder address). Do not file public issues or discuss the vulnerability in public channels until we have coordinated a disclosure.

If you believe you have found active exploitation or an imminent risk, say so clearly in the subject line.

## What to include in your report

Please include as much of the following as you can:

- A clear description of the issue and why you think it is a security problem
- Affected component (repository area, package, or subsystem) and version or commit if known
- Steps to reproduce, or proof-of-concept details, with minimal necessary information
- Potential impact (confidentiality, integrity, availability) if you can assess it
- Whether you believe the issue is already public or actively exploited

Encrypted email is not required unless we publish a PGP key; if we do, prefer that channel for sensitive material.

## Response timeline

These are goals, not guarantees; severity and maintainer availability may adjust timing.

- **Within 48 hours:** We aim to acknowledge receipt of your report.
- **Within 7 days:** We aim to provide an initial assessment (valid issue, needs more information, duplicate, or out of scope) and next steps when possible.

We will keep you reasonably informed as the issue is triaged and addressed.

## Scope

**In scope** (examples):

- Security flaws in this repository’s code, build, or documented default configurations shipped here
- Issues that could lead to unauthorized access, data exposure, or unsafe execution in supported use of CAR components

**Typically out of scope** (examples):

- Social engineering or physical attacks
- Issues in third-party services or dependencies unless they manifest as a defect in how this project uses them
- Theoretical problems without a plausible exploit path
- Denial-of-service that requires overwhelming resources in ways we do not intend to mitigate in pre-v1 software

If you are unsure, report anyway; we can clarify scope in our response.

## Disclosure policy

We follow **coordinated disclosure**:

- Please give us a reasonable time to investigate and prepare a fix before public disclosure.
- We ask that you do not publish details until we agree on a disclosure date, or until we confirm we will not fix the issue, or until a mutually agreed timeout if we cannot respond.
- We will credit reporters who wish to be named, unless they prefer to remain anonymous.

Thank you for helping keep Chat Agent Relay and its users safer.
