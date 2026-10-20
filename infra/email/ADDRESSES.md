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
| `contact@` | iCloud custom domain | Predates this table. Not printed anywhere in the product — kept because it exists and somebody may have given it out |

Aliases are created in the iCloud+ Custom Email Domain settings. There
is no API and no script: this file is the declaration, Apple holds the
configuration.

**A catch-all is enabled.** Mail to any address at lexyflow.com now
arrives rather than disappearing, which removes the failure mode that
started all of this. It does not remove the reason for this table: a
catch-all says mail lands somewhere, not that anybody reads it, and not
which obligation each address answers. An address published on a
contract and an address nobody expects are different things, and the
catch-all cannot tell them apart.

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

## Resolved: the phantom inbound pipeline is gone

`infra/cloudflare-email-worker/` described a Worker named
`lexyflow-inbound`, fed by `replies@go.lexyflow.com`, posting to
`/api/webhooks/inbound`. The Cloudflare account held zero Workers and
zero zones: it never existed, while the route receiving it did.

Deleted on 20 October, by the operator's decision — the folder, the
route, `lib/reply-classifier.ts` which nothing else imported, its tests,
and the `INBOUND_WEBHOOK_SECRET` entry in the config report. The
variable itself is now inert in Vercel and can be removed there.

The `outreach_*` tables stay: `/api/outreach/unsubscribe/[token]` reads
them and is live. If inbound mail ever needs handling by API, it gets
built against a provider that exists.
