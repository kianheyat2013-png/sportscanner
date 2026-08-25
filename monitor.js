const players = [
  { name: 'Shohei Ohtani', sport: 'baseball', query: 'Shohei Ohtani card' },
  { name: 'Paul Skenes', sport: 'baseball', query: 'Paul Skenes card' },
  { name: 'Victor Wembanyama', sport: 'basketball', query: 'Victor Wembanyama card' },
  { name: 'Cam Ward', sport: 'football', query: 'Cam Ward card' },
];

const ebayEndpoint = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const minimumUpside = Number(process.env.MINIMUM_UPSIDE || 0.2);
const minimumTitleMatch = 2;

function required(name) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
  return process.env[name];
}

async function getEbayListings(player) {
  const url = new URL(ebayEndpoint);
  url.searchParams.set('q', player.query);
  url.searchParams.set('limit', '20');
  url.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE}');
  url.searchParams.set('sort', 'newlyListed');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${required('EBAY_BROWSE_TOKEN')}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
  if (!response.ok) throw new Error(`eBay request failed for ${player.name}: ${response.status}`);
  const body = await response.json();
  return (body.itemSummaries || []).map((item) => ({
    ...item,
    itemId: item.itemId,
    title: item.title,
    itemWebUrl: item.itemWebUrl || (item.itemId ? `https://www.ebay.com/itm/${item.itemId}` : ''),
    price: Number(item.price?.value),
    currency: item.price?.currency || 'USD',
    player: player.name,
    sport: player.sport,
    condition: item.condition || 'Unknown condition',
    seller: item.seller?.username || 'Unknown seller',
    imageUrl: item.image?.imageUrl || '',
    listingDetails: item,
  })).filter((item) => item.itemId && item.itemWebUrl && Number.isFinite(item.price) && item.price > 0 && item.currency === 'USD' && titleMatchScore(item.title, player.name) >= minimumTitleMatch);
}

function titleMatchScore(title, player) {
  const words = player.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  const normalizedTitle = title.toLowerCase();
  return words.filter((word) => normalizedTitle.includes(word)).length;
}

async function getCardLadderMedian(listing) {
  const url = new URL(required('CARDLADDER_COMPS_URL'));
  url.searchParams.set('player', listing.player);
  url.searchParams.set('listingTitle', listing.title);
  url.searchParams.set('condition', listing.condition);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${required('CARDLADDER_TOKEN')}` } });
  if (!response.ok) throw new Error(`Card Ladder request failed for ${listing.player}: ${response.status}`);
  const body = await response.json();
  const median = Number(body.median ?? body.marketValue ?? body.value);
  if (!Number.isFinite(median) || median <= 0) throw new Error(`Card Ladder response has no positive median for ${listing.title}`);
  return median;
}

async function sendDiscord(deals) {
  if (!deals.length) return;
  const content = deals.map((deal) => `**${deal.player}**: ${deal.title}\n$${deal.price.toFixed(2)} ask vs. $${deal.marketValue.toFixed(2)} Card Ladder median (${Math.round(deal.upside * 100)}% upside)\n${deal.itemWebUrl}`).join('\n\n');
  const response = await fetch(required('DISCORD_WEBHOOK_URL'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: `Scoutline found ${deals.length} new card deal${deals.length === 1 ? '' : 's'}:\n\n${content}` }) });
  if (!response.ok) throw new Error(`Discord webhook failed: ${response.status}`);
}

async function main() {
  const playerResults = await Promise.allSettled(players.map(getEbayListings));
  playerResults.filter((result) => result.status === 'rejected').forEach((result) => console.warn(result.reason.message));
  const listings = [...new Map(playerResults.filter((result) => result.status === 'fulfilled').flatMap((result) => result.value).map((listing) => [listing.itemId, listing])).values()];
  const scored = (await Promise.all(listings.map(async (listing) => {
    try {
      const marketValue = await getCardLadderMedian(listing);
      const upside = (marketValue - listing.price) / marketValue;
      return upside >= minimumUpside ? { ...listing, marketValue, upside, score: upside * Math.min(1, Math.max(0.5, titleMatchScore(listing.title, listing.player) / 2)) } : null;
    } catch (error) {
      console.warn(`Skipping ${listing.itemId}: ${error.message}`);
      return { ...listing, marketValue: null, upside: null, score: 0, edge: '+0%', confidence: 'Pending', valuationPending: true, detail: `${listing.condition} · Buy It Now · Card Ladder valuation pending` };
    }
  }))).filter(Boolean);
  const verified = scored.filter((deal) => !deal.valuationPending).sort((first, second) => second.score - first.score);
  const pending = scored.filter((deal) => deal.valuationPending).slice(0, 10);
  const output = [...verified.slice(0, 10), ...pending].map((deal) => ({ ...deal, price: Number(deal.price.toFixed(2)), marketValue: deal.marketValue === null ? null : Number(deal.marketValue.toFixed(2)), edge: deal.valuationPending ? 'PENDING' : `+${Math.round(deal.upside * 100)}%` }));
  await import('node:fs/promises').then(({ writeFile }) => writeFile('deals.json', JSON.stringify({ generatedAt: new Date().toISOString(), deals: output }, null, 2)));
  await sendDiscord(verified.slice(0, 10));
  console.log(`Scanned ${listings.length} eBay listings, verified ${verified.length} deals, and retained ${pending.length} pending candidates.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
