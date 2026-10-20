# Where mail to lexyflow.com arrives

A test message to `legal@lexyflow.com` vanished on 19 October 2026: no
forward, no bounce, no trace. `legal@` is printed on the DPA as the
address where a customer asks for a signed counterpart, in the legal
footer, on the integrations page, and in the signature of every
lifecycle e-mail in seven languages. Somebody exercising a contractual
right wrote into a void.

**The defect was never the missing alias.** It was that no file in this
repository recorded which addresses were supposed to exist, so nothing
could notice one did not. This file is that record, and
`tests/published-addresses-routed.test.ts` fails if the application
publishes an address this table does not list.

## The addresses

| Address | Where it arrives | Why it is published |
| --- | --- | --- |
| `legal@` | iCloud custom domain | DPA signed counterparts, legal footer, integrations page, lifecycle signoffs |
| `privacy@` | iCloud custom domain | DPO contact on `/trust` and `/privacy` |
| `security@` | iCloud custom domain | Vulnerability reports |
| `support@` | iCloud custom domain | Product support |
| `hello@` | iCloud custom domain | `RESEND_FROM` — the transactional sender. Unrouted, every customer REPLY to a sign-in link or an audit notification is lost the same way `legal@` was |
| `dmarc@` | iCloud custom domain | `rua=` target, so DMARC reports arrive somewhere |

Aliases are created in the iCloud+ Custom Email Domain settings. There
is no API and no script: this file is the declaration, Apple holds the
configuration.

## How the mail actually flows

DNS is at **Namecheap**, not Cloudflare. The zone is in no Cloudflare
account the operator belongs to — `GET /zones?name=lexyflow.com` returns
`total_count: 0`, and the call succeeds rather than refusing.

```
MX  @      mx01.mail.icloud.com         inbound, everything above
MX  @      mx02.mail.icloud.com
MX  send   feedback-smtp.eu-west-1…     Resend bounce handling only
```

Sending and receiving are independent, which is why `hello@` can be the
Resend sender and an iCloud mailbox at the same time:

```
From:           hello@lexyflow.com
SPF envelope    send.lexyflow.com → include:amazonses.com   pass
DKIM            d=lexyflow.com (resend._domainkey)          pass, aligned
DMARC           passes on both paths
```

The root SPF names only iCloud (`v=spf1 include:icloud.com ~all`) and
that is correct: Resend sends under the `send` subdomain, so its SPF is
checked there.

## What this replaces

`infra/cloudflare-email-worker/routing.sh`, deleted in the same commit.
It managed Cloudflare Email Routing for a domain that is not on
Cloudflare — written from a diagnosis of the silent loss that turned out
to be unsupported. The list it carried was right; the provider was not.

## Still unresolved

`infra/cloudflare-email-worker/` describes a Worker named
`lexyflow-inbound`, fed by `replies@go.lexyflow.com`, posting to
`/api/webhooks/inbound`. The account holds zero Workers and zero zones,
so that pipeline does not exist — while the route that receives it does.
Deleting the worker would orphan the webhook; keeping it documents
infrastructure nobody built. That is a decision, not a cleanup, and it
has not been made.
