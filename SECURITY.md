# Security policy — gnome-display-tuner

## Supported versions

Only the current `main` branch gets security fixes.

## Reporting a vulnerability

Do not open a public issue.

Use [private vulnerability reporting](https://github.com/fqazzazee/gnome-display-tuner/security/advisories/new),
or email fadi.qazzazee@gmail.com with the details and, if you have one, a proof of
concept.

Expect an acknowledgment within 72 hours and an assessment within a week. If a fix is
warranted, you will get the timeline and credit in the release notes unless you would
rather not be named.

## Scope

**In scope:** the extension code in this repository and its default settings. The
extension runs inside GNOME Shell with your user's privileges, so anything that lets
outside input run as code there, or reach a command line as more than data, is worth
reporting.

**Out of scope:** bugs in GNOME Shell itself, and anything that requires an attacker to
already have the privileges the issue would grant.
