---
slug: launch-search-campaign
name: Launch a search campaign
description: Turn a landing page into a Google Search campaign — keywords, negatives, one responsive search ad, callouts and sitelinks — proposed as one google_ads.create_search_campaign card.
---

# Launch a search campaign

1. **Read the page.** Fetch the landing page. Note the offer, the price, the audience, the claims it makes, and the call to action. Check that the sitelink pages you plan to use exist.
2. **Read the account.** `ads_report conversions`: which conversion action counts what this page is for (a sign-up, a lead)? If one exists, pass its id as `conversion_action_ids` so the campaign counts only it, never the account's defaults for other products. If none exists, say the campaign will buy clicks without a conversion goal, and recommend creating one.
3. **Keywords:** 10 to 25, EXACT and PHRASE, on the searches the page answers. A competitor's name is fine as a keyword ("alternative to X"); a generic term that brings everyone is not.
4. **Negatives:** the other meanings of the words (a brand that is also a common noun), jobs, careers, logins, free downloads when the page sells, and a competitor's own support searches.
5. **The ad:** 10 to 15 headlines of at most 30 characters and 4 descriptions of at most 90, every claim from the page. Path fields name the offer.
6. **Bidding:** Maximize clicks with a bid ceiling (`max_cpc`) until the campaign has converted 30 times; say so.
7. **Tracking:** a `url_suffix` with utm_source=google, utm_medium=cpc and a utm_campaign named for the page.
8. **Propose** one `google_ads.create_search_campaign` with the budget asked for. It runs only once a person approves the card. After approval, report what was created, its status, and that Google reviews the ad before it shows.
