/**
 * Spread the run's budget across sources instead of giving it to whoever
 * published most recently.
 *
 * Oman arrived and took the whole queue. Its sitemap holds 169 URLs under
 * the ministry's newsroom prefix, the poller takes 40 a run, and at eight
 * extractions every six hours that is five days during which every ICO
 * reprimand and CNIL sanction waits behind a logistics day and a
 * programming contest. Nothing was broken — newest-first is a reasonable
 * policy and the items really were newest — but a source with a large
 * backlog and no yield could starve the sources that produce everything
 * we publish.
 *
 * So: one item per source per pass, round and round until the budget is
 * spent. A regulator that publishes one decision this week gets it read
 * in the next run rather than in a fortnight, and a source flooding the
 * queue drains at its own pace without holding the others hostage.
 *
 * Order within a source is preserved, so newest-first still decides which
 * of Oman's items goes next — just not whether Oman goes at all.
 */
export function fairShare<T extends { source_id: string }>(rows: T[], budget: number): T[] {
  const bySource = new Map<string, T[]>();
  for (const row of rows) {
    const list = bySource.get(row.source_id);
    if (list) list.push(row);
    else bySource.set(row.source_id, [row]);
  }

  // Insertion order of the map is the order the sources first appear in
  // the newest-first list, so the source with the freshest item still
  // goes first in each pass.
  const picked: T[] = [];
  while (picked.length < budget) {
    let tookOne = false;
    for (const list of bySource.values()) {
      if (picked.length >= budget) break;
      const next = list.shift();
      if (!next) continue;
      picked.push(next);
      tookOne = true;
    }
    if (!tookOne) break;
  }

  return picked;
}
