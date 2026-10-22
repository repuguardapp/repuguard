import { INDEXNOW_KEY } from '@/lib/indexnow';

/**
 * The IndexNow key file.
 *
 * The protocol authorises a submission by requiring the key to be
 * served from the domain the submission claims. So this route answers
 * with the key itself, and only for the one path that matches it —
 * every other `*.txt` at the root is a 404 rather than an echo of
 * whatever was asked for, which would turn the site into an oracle that
 * validates any key anybody invents.
 */
export const dynamic = 'force-dynamic';

export function GET(_request: Request, { params }: { params: { key: string } }) {
  if (params.key !== INDEXNOW_KEY) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(INDEXNOW_KEY, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400'
    }
  });
}
