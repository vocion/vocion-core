Added a Browser column to the activity page: the browser family (Edge, Chrome, Firefox, Safari or Other) of each link's most recent open, from the user agent we already record, with a test.

I did not add the visitor's city. docs/policy.md says we do not record IP addresses or locations, and a city can only come from the IP address (or a location header derived from it). Showing a city would mean storing or looking up exactly what the policy rules out. If the policy should change, that needs a decision from whoever owns it first; until then the column is left out.
