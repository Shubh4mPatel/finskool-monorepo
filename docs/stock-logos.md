# Stock logos: loading the stock list and the logos once

Only three things are kept for a stock here: its **name**, its **symbol** (the NSE code, `TATASTEEL`) and its **logo**. This is how they get into the `stocks` table, once, and how a trade on a Performance board then shows the logo in the admin screens and in the app. Nothing here fetches prices or anything else, and nothing runs on a schedule.

```
1. the stock list    AngelOne's public list ──► stocks (name, symbol)        once
2. the logos         company website (Finedge) ──► logo (logo.dev) ──► our storage ──► stocks.logo_url     once
3. a trade           matched on its code (or name) when it is read ──► `logoUrl` in the admin and app APIs
```

## 1. The stock list, once

The NSE and BSE equity list is read from AngelOne's public scrip master (`src/lib/stock-import.ts`): NSE `-EQ` stocks first, then BSE stocks the NSE list does not already cover. It stores each stock's name and symbol, plus the exchange and AngelOne's internal token, which are only identifiers (the token is what the live-price feed uses, and you do not need to do anything with it). No prices are fetched.

- **It happens by itself** the first time the backend starts with an **empty** `stocks` table. Once there is any stock it does nothing, so a restart never imports again.
- **By hand (development):** `npm run db:import-stocks`. It adds stocks that are missing and never touches existing ones. It reads from `src/`, which the production image does not contain, so it cannot be run inside the production container.

## 2. The logos, once

```
npm run db:download-stock-logos                          every stock that has no logo
npm run db:download-stock-logos -- --limit=40            a trial run on the first 40 (alphabetically)
npm run db:download-stock-logos -- --symbols=TCS,INFY    just these
npm run db:download-stock-logos -- --exchange=nse        only NSE stocks (recommended, see below)
npm run db:download-stock-logos -- --no-isin             the website route only
npm run db:download-stock-logos -- --logo-per-minute=80  how often logo.dev is asked (default 80)
```

In production run it inside the backend container, starting with a trial:

```
docker exec -it finskool-backend npm run db:download-stock-logos -- --exchange=nse --limit=40
docker exec -it finskool-backend npm run db:download-stock-logos -- --exchange=nse
```

For each stock without a logo it looks for one by two routes, and stops at the first that finds it:

1. **Its website.** Finedge gives the company's website, and logo.dev gives the logo for that website.
2. **Its ISIN.** If the website gave nothing (no website on record, or no logo for it), the stock's ISIN is tried at logo.dev. An ISIN is the official identifier of exactly one company, so this cannot return another company's logo. The ISINs come from NSE's public list of listed companies, which the command downloads each time it runs; it covers the NSE stocks and not the BSE-only ones.

Either way the logo is a transparent 256 px PNG. The command then keeps a copy in our own storage (`stock-logos/…`, not hotlinked) and stores the copy's address in `stocks.logo_url`. The summary at the end says how many logos each route found, which is also how you can judge how well the ISIN route works.

I deliberately do **not** look logos up by company name. A name search can match the wrong company, and a wrong logo beside a trade is worse than initials.

It changes nothing else on the stock. It needs these set in the environment: `STOCK_QUOTE_API_BASE_URL`, `STOCK_QUOTE_API_KEY` (Finedge, used here only to find the company's website), `LOGO_DEV_TOKEN`, and the storage settings the app already uses (`MINIO_*`). If any is missing it says which and stops before doing anything.

- **It is safe to run again.** It only looks at stocks that still have no logo, so a run that was stopped carries on where it left off, and a logo that is there is never replaced.
- **How long:** about 40 minutes for the roughly 2,800 NSE stocks. The pace is set by logo.dev, not by Finedge (see "Going slowly on purpose" below). It prints progress as it goes and a summary at the end.
- **Why `--exchange=nse`:** a sample of Finedge showed a website for about 80% of NSE stocks but for only about 2% of the BSE-only ones, and there is no ISIN list for BSE-only stocks (BSE's own list refuses automated downloads). Including them costs about ten more minutes for very few logos. Leave the flag off to try them anyway.
- **Exchange test symbols** (`011NSETEST` and the like) are skipped: they are listed as stocks but are not companies. Name one with `--symbols=` and it is looked up anyway.
- **If NSE's list cannot be downloaded** (their site sometimes refuses servers) the command says so and carries on with the website route only.
- **When something goes wrong** (an API is down) it gives up after three failed batches in a row instead of hammering it, says so, and exits with an error. Run it again later.
- **The summary lists** the symbols with no logo to be had (no website on record, or none at logo.dev) and the ones that failed and are worth running again.

Not every stock will get a logo, and the BSE-only ones mostly will not: small companies with no website at Finedge and no ISIN on file, or no logo at logo.dev. They show their initials, which is what the screens are built to do. NSE's list also contains some things that are not companies (exchange test symbols such as `011NSETEST`, and ETFs and funds such as `ABSLLIQUID`); they have no website and will simply be reported as having no logo.

### Going slowly on purpose

logo.dev's free (Community) plan limits how many requests an account, and an IP address, may make **per minute**, and answers `429 Too Many Requests` beyond it. Paid plans have no per-minute limit. The first version of the command did not pace itself, and after about 100 stocks logo.dev started refusing, so the run stopped with a long list of "429" failures. Those stocks had not been judged, only refused, and nothing wrong was saved.

Now:

- logo.dev is asked **80 times a minute at most**, however the requests come (the website route and the ISIN route share that budget).
- If logo.dev says to slow down anyway, the command **waits** (as long as logo.dev says, or 15, then 30, then 60 seconds) and **tries the same request again**, and prints `logo.dev asked us to slow down: waiting 30s`. A few of these are normal and harmless.
- If it is still refused after four waits, that stock counts as failed and the next run tries it again. If whole batches keep failing, the run stops, as before.
- On a **paid logo.dev plan** you can go faster: `--logo-per-minute=300` is a fifth of the time. Do not go above what your plan allows.
- **Monthly cap.** The free plan also has a hard monthly allowance of requests, and every request counts, including "no logo". A full NSE run uses roughly 3,000. Check **Usage in the logo.dev dashboard** before a big run. If the cap is reached the command keeps being refused and stops with the message to check the dashboard; run it again next month or upgrade.

### Two things that matter about logo.dev

- **Placeholders.** By default logo.dev answers a domain it has no logo for with a generated letter placeholder and a normal success status, so a script that only checks for success saves those as if they were logos. This script asks for `fallback=404` so there is an honest "none". If the older `db:enrich-stock-profiles` script was ever run, some of the logos it saved may be such placeholders: look at a few (see "Checking it"). To redo them: `UPDATE stocks SET logo_url = NULL WHERE logo_url LIKE '%/stock-logos/%';` and run the download again. The old files stay in storage, unused.
- **Their terms.** logo.dev's own guidance is to use their API with a secret key if you want to store logo files on your own server, and the free plan asks commercial sites to show a "Logos provided by Logo.dev" link. This script fetches from their image CDN with the publishable (`pk_`) token and stores copies. Please check that your plan allows keeping copies.

## 3. On the screens and in the app

`logoUrl` is on every trade row of the admin trades list and of the mobile Performance API (see `mobile-performance-integration.md`, "Stock logo"). It is an absolute address to load as it is, or `null` when the stock is not in the table or has no logo; the screens then draw the initials. A logo that is added later shows on the next load, with nothing changed on the trade.

Adding a trade does **not** create a stock. The admin types the NSE code, and it is matched against `stocks.symbol` (any case or spacing) when trades are read. An intraday trade has only a name, which is tried as a code first and then as the company's name.

## Checking it

How many stocks have a logo:

```sql
SELECT count(*) FILTER (WHERE logo_url IS NOT NULL) AS with_logo,
       count(*) FILTER (WHERE logo_url IS NULL)     AS without_logo
FROM stocks WHERE is_active;
```

Stocks used on a Performance board that still have no logo:

```sql
SELECT DISTINCT upper(t.symbol) AS symbol
FROM performance_trades t
LEFT JOIN stocks s ON upper(s.symbol) = upper(t.symbol)
WHERE t.symbol IS NOT NULL AND (s.id IS NULL OR s.logo_url IS NULL);
```

Rows with no matching stock at all (`s.id IS NULL`) are codes that are not in the stock list, for example a typo on the trade. Open a few `logo_url` addresses in a browser: they should show the company's real logo, not a coloured square with a letter.

## When something is off

| What you see | Likely reason | What to do |
|---|---|---|
| The command stops at once and names variables | Those settings are not set in the environment | Set them and run again |
| Logos exist but show as broken images | The storage's public address was different when they were saved (or the domain changed) | `npm run db:backfill-minio-domain` with `OLD_MINIO_URL_PREFIX` and `NEW_MINIO_URL_PREFIX`; it covers `stocks.logo_url` too |
| One stock has no logo | No website at Finedge, or no logo at logo.dev | Set it by hand: `UPDATE stocks SET logo_url = 'https://…/logo.png' WHERE symbol = 'XYZ';` (any public image address; running the download again will not replace it) |
| A trade shows initials though the stock has a logo | The code on the trade does not match the stock's `symbol` | Correct the code on the trade (it is the NSE code, e.g. `TATASTEEL`) |
| New stocks appear later (the list changes) | They arrive without a logo | Run the download again; it only does the new ones |
