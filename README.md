# Scoutline

Scoutline is a focused UI prototype for an AI sports-card deal scanner. It presents a live-feed workflow, Card Ladder market-value comparisons, watchlist targets, and email/Discord delivery controls.

## Run locally

Open `index.html` directly in a browser, or run a local server from this directory:

```bash
npx serve .
```

The local page falls back to representative preview data when `deals.json` is not available. Preview rows show sample prices but are deliberately not clickable. Once the remote worker generates `deals.json`, every live row shows the eBay ask price, condition, buying option, seller, location, and shipping when supplied, and renders a clickable link from eBay's returned `itemWebUrl`. The worker also retains the complete eBay summary under `listingDetails` for downstream listing details.

If the page says “Actual listing link appears after live scan,” the scheduled worker has not published a live feed yet. This is intentional: a search URL is not the listing the scanner found.

## Run while your laptop is off

`monitor.js` is a remote-friendly scan worker. It searches fixed-price Buy It Now listings, which includes listings offering Best Offer, and excludes auctions. It writes the scored results to `deals.json` using eBay's actual `itemWebUrl` values and sends those same URLs to Discord. The included GitHub Actions workflow runs it every 15 minutes and can be triggered manually from the Actions tab. Add these repository secrets before enabling it:

- `EBAY_BROWSE_TOKEN`: an eBay OAuth application token with Browse API access
- `CARDLADDER_COMPS_URL`: an authorized Card Ladder adapter endpoint that accepts `player` and `listingTitle` and returns `{ "median": 123.45 }`
- `CARDLADDER_TOKEN`: the token for that adapter or licensed Card Ladder integration
- `DISCORD_WEBHOOK_URL`: the Discord channel webhook that receives deal links

The worker only sends deals at or above `MINIMUM_UPSIDE` (20% by default). It rejects results without an eBay item ID, direct item URL, USD price, or both player-name words in the title; duplicate item IDs are removed. If a comp lookup fails, the real eBay candidate is still written to `deals.json` as `valuationPending` with its direct listing URL, but it is not sent as a deal alert. Card Ladder does not provide a public endpoint that can be safely assumed here, so the adapter must use an authorized integration or licensed export; do not scrape or hard-code credentials.

## Production wiring

To make scanning real, add a small server that authenticates with eBay's Browse API, searches the user's watchlist, and retrieves Card Ladder data through an authorized Card Ladder integration or licensed export. Normalize card identity, grade, and sale date before calculating a median or trimmed average; never compare raw cards with graded comps. Keep both providers' credentials server-side. A scheduled worker can then send qualifying listing URLs through an email provider and a Discord webhook; the browser UI should call that service instead of simulating the scan.
