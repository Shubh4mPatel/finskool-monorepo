# Stocks and their logos: loading the stock sheet and the logos once

The `stocks` table is loaded **once** from a spreadsheet, and the logos are then downloaded **once** from logo.dev into our own storage (MinIO). This is how a trade on a Performance board shows the logo in the admin screens and in the app. Nothing here fetches prices, and nothing runs on a schedule.

```
1. the stock sheet    India_NSE_BSE_Equity_Stocks.xlsx (in the repo) ──► stocks (name, symbol, ISIN, website, sector…)   once
2. the logos          stocks.website, else stocks.ISIN ──► logo.dev ──► our storage (MinIO) ──► stocks.logo_url         once
3. a trade            matched on its code (or name) when it is read ──► `logoUrl` in the admin and app APIs
```

## 1. The stock sheet, once

The list of stocks is the spreadsheet `apps/backend/prisma/seed-assets/India_NSE_BSE_Equity_Stocks.xlsx`, sheet **Stocks**: 5,586 companies, one row per ISIN (2,480 on NSE and BSE, 723 NSE only, 2,383 BSE only). It goes out with the backend image, so it is inside the container after a deploy.

| Sheet column | `stocks` column |
|---|---|
| ISIN | `isin` (unique) |
| Company Name | `name` |
| NSE Symbol, else BSE Symbol | `symbol` (see below) |
| BSE Code, BSE Symbol | `bse_code`, `bse_symbol` |
| Listed On | `listed_on` (`nse_bse`, `nse`, `bse`), and `exchange` (`bse` for BSE only, otherwise `nse`) |
| NSE Board, NSE Series | `nse_board`, `nse_series` |
| Sector, Industry | `sector`, `industry` |
| Website | `website` |
| NSE Listing Date, Face Value | `nse_listing_date`, `face_value` |

```
npm run db:load-stocks                    DRY RUN: says what it would do, writes nothing
npm run db:load-stocks -- --apply         does it, in one transaction (all or nothing)
npm run db:load-stocks -- --apply --reset-logos    also clears every existing logo, so step 2 fetches them all again
npm run db:load-stocks -- --file=/path/to/other.xlsx
```

In production, always look at the dry run first:

```
docker exec -it finskool-backend npm run db:load-stocks
docker exec -it finskool-backend npm run db:load-stocks -- --apply
```

**It makes the table match the sheet, and it does not empty the table first.** A stock in the sheet is matched to its existing row (by ISIN, else by symbol) and updated in place, so the row keeps what the sheet does not have:

- `token`, `cmp`, `close_price`: the live-price feed subscribes by `token`, which the sheet does not have. Emptying the table would have switched the live prices off.
- `logo_url`: logos already downloaded are not downloaded again (use `--reset-logos` to start over).
- `id`: stock recommendations point at a stock by id.

A stock that is **not** in the sheet is deleted, or only **switched off** (`is_active = false`) when a stock recommendation refers to it. The command lists both. It also warns about any of them that is on a Performance trade, since that trade then loses its logo.

Other things it takes care of:

- **The symbol.** The NSE symbol when the company is on NSE (so existing Performance trades and recommendations keep matching). A BSE-only company has no NSE symbol and gets its BSE symbol. Seven BSE-only companies have a BSE symbol that another company already uses as its NSE symbol (`FOCUS`, `GSTL`, `KALYANI`, `MAL`, `RAJPUTANA`, `SEL`, `ZEAL`); the symbol must be unique, so those get their **BSE code** (for example `543312`) instead. The command prints them.
- **The exchange of a stock with a token is not changed**: the token only works on the exchange it came from.
- **A blank sector in the sheet does not erase** a sector that is already there.
- **A row it cannot read** (bad ISIN, no name, an unknown "Listed On"…) is reported and left out. Because a stock missing from the sheet gets removed, `--apply` refuses to run while there are such rows, unless you pass `--skip-bad-rows`.
- **Two stocks that would end up with the same symbol** stop the command before it writes anything.
- **It is safe to run again**: a second run finds nothing to change.

`npm run db:import-stocks` (AngelOne's list) is the **old** way and should not be run any more: it would add AngelOne's stocks back, and the next load of the sheet would remove them. The backend still imports that list at boot, but only when the `stocks` table is **empty**, which it no longer is.

## 2. The logos, once

```
npm run db:download-stock-logos                          every stock that has no logo
npm run db:download-stock-logos -- --limit=40            a trial run on the first 40 (alphabetically)
npm run db:download-stock-logos -- --symbols=TCS,INFY    just these
npm run db:download-stock-logos -- --exchange=nse        only stocks whose exchange is NSE
npm run db:download-stock-logos -- --no-isin             the website route only
npm run db:download-stock-logos -- --logo-per-minute=80  how often logo.dev is asked (default 80)
```

In production run it inside the backend container, starting with a trial:

```
docker exec -it finskool-backend npm run db:download-stock-logos -- --limit=40
docker exec -it finskool-backend npm run db:download-stock-logos
```

Load the sheet first (step 1): the websites and ISINs it looks up are the ones in the `stocks` table. For each stock without a logo it looks for one by two routes, and stops at the first that finds it:

1. **Its website** (`stocks.website`). logo.dev gives the logo for that website. 4,617 of the 5,586 stocks have one.
2. **Its ISIN** (`stocks.isin`). If the website gave nothing (no website on record, or no logo for it), the ISIN is tried at logo.dev. An ISIN is the official identifier of exactly one company, so this cannot return another company's logo. Every stock in the sheet has one, so the 969 without a website get their chance here.

Either way the logo is a transparent 256 px PNG. The command keeps a copy in our own storage (`stock-logos/…`, not hotlinked) and stores the copy's address in `stocks.logo_url`. The summary at the end says how many logos each route found, which is also how you can judge how well the ISIN route works.

Companies of one group share a website, so several stocks can need the same logo; logo.dev is asked for it once.

I deliberately do **not** look logos up by company name. A name search can match the wrong company, and a wrong logo beside a trade is worse than initials.

It changes nothing else on the stock. It needs these set in the environment: `DATABASE_URL`, `LOGO_DEV_TOKEN`, and the storage settings the app already uses (`MINIO_*`). If any is missing it says which and stops before doing anything. (Finedge is no longer used here; `STOCK_QUOTE_*` is still what the daily close-price sweep uses.)

- **It is safe to run again.** It only looks at stocks that still have no logo, so a run that was stopped carries on where it left off, and a logo that is there is never replaced.
- **How big it is.** The start of the run says how many stocks are to be looked up and the least number of logo.dev requests that means: one for every stock that has a website or an ISIN, which is about 5,600 for the whole sheet, so **at least 70 minutes** at 80 a minute. A stock whose first answer is "no logo" is asked again by the other route, which costs more requests. The pace is set by logo.dev (see "Going slowly on purpose" below). It prints progress as it goes and a summary at the end.
- **Check the monthly allowance first.** The free plan has a hard monthly cap on requests and every request counts, "no logo" answers included. A full run is well over 5,000 requests: look at **Usage in the logo.dev dashboard** before starting, and use `--limit=40` first.
- **When something goes wrong** (an API is down) it gives up after three failed batches in a row instead of hammering it, says so, and exits with an error. Run it again later.
- **The summary lists** the symbols with no logo to be had (no website and no ISIN on record, or none at logo.dev) and the ones that failed and are worth running again.
- **Exchange test symbols** (`011NSETEST` and the like) are skipped. Name one with `--symbols=` and it is looked up anyway.

Not every stock will get a logo: small companies have none at logo.dev. ETFs and funds have no website. They show their initials, which is what the screens are built to do.

### Going slowly on purpose

logo.dev's free (Community) plan limits how many requests an account, and an IP address, may make **per minute**, and answers `429 Too Many Requests` beyond it. Paid plans have no per-minute limit. The first version of the command did not pace itself, and after about 100 stocks logo.dev started refusing, so the run stopped with a long list of "429" failures. Those stocks had not been judged, only refused, and nothing wrong was saved.

Now:

- logo.dev is asked **80 times a minute at most**, however the requests come (the website route and the ISIN route share that budget).
- If logo.dev says to slow down anyway, the command **waits** (as long as logo.dev says, or 15, then 30, then 60 seconds) and **tries the same request again**, and prints `logo.dev asked us to slow down: waiting 30s`. A few of these are normal and harmless.
- If it is still refused after four waits, that stock counts as failed and the next run tries it again. If whole batches keep failing, the run stops, as before.
- On a **paid logo.dev plan** you can go faster: `--logo-per-minute=300` is a fifth of the time. Do not go above what your plan allows.

### Two things that matter about logo.dev

- **Placeholders.** By default logo.dev answers a domain it has no logo for with a generated letter placeholder and a normal success status, so a script that only checks for success saves those as if they were logos. This script asks for `fallback=404` so there is an honest "none". If the older `db:enrich-stock-profiles` script was ever run, some of the logos it saved may be such placeholders: look at a few (see "Checking it"). To redo them: `npm run db:load-stocks -- --apply --reset-logos` and run the download again. The old files stay in storage, unused.
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

That the sheet is loaded (expect 5,586 active stocks, all with an ISIN):

```sql
SELECT count(*) AS stocks, count(*) FILTER (WHERE is_active) AS active, count(isin) AS with_isin, count(website) AS with_website FROM stocks;
```

## When something is off

| What you see | Likely reason | What to do |
|---|---|---|
| A command stops at once and names variables | Those settings are not set in the environment | Set them and run again |
| `db:load-stocks -- --apply` says it will not apply while rows are unreadable | The sheet has rows it cannot use (they are listed) | Fix the sheet, or `--skip-bad-rows` if leaving them out is intended |
| `db:load-stocks` says "symbol … would be on two stocks" | A stock that a recommendation refers to, and that is not in the sheet, holds a symbol the sheet gives to another company | Nothing was written. Rename that stock's symbol by hand, then run again |
| Logos exist but show as broken images | The storage's public address was different when they were saved (or the domain changed) | `npm run db:backfill-minio-domain` with `OLD_MINIO_URL_PREFIX` and `NEW_MINIO_URL_PREFIX`; it covers `stocks.logo_url` too |
| One stock has no logo | No website and no ISIN on record, or no logo at logo.dev | Set it by hand: `UPDATE stocks SET logo_url = 'https://…/logo.png' WHERE symbol = 'XYZ';` (any public image address; running the download again will not replace it) |
| A trade shows initials though the stock has a logo | The code on the trade does not match the stock's `symbol` | Correct the code on the trade (it is the NSE code, e.g. `TATASTEEL`) |
| A trade shows initials since the sheet was loaded | Its stock is not in the sheet, so it was removed | The load printed it under "Performance trades". Add it to the sheet, or correct the code on the trade |
| New stocks appear later (the list changes) | A new sheet needs loading | Put the new file in `prisma/seed-assets/`, deploy, run `db:load-stocks` (dry run, then `--apply`) and the logo download again; it only does the new ones |
