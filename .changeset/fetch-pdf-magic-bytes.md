---
"@harpua/agent-tools": patch
---

`fetch_pdf` now accepts valid PDFs served with a non-`application/pdf` content-type (e.g. `application/octet-stream`, the default for GitHub raw / S3 / many CDNs) by sniffing the `%PDF-` magic bytes of the already-fetched body. It still refuses genuine non-PDF bodies — it just stops trusting a mislabeled header over the actual content.
