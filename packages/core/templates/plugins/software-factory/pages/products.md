Each row is a product a person answers for. **Stage**, **our price** and the
**incumbent's dated list price** are read from the record. **Health**, **last
shipped** and **open work** are agent-maintained: the lead's
`keep-the-board-honest` tick recomputes them each morning from the request and
release records underneath, and stamps when. While a product's figures are
current the board says nothing about that; once they go a day stale the row
says so, because freshness is only news when it stops.

**Health is a reading, not a guess.** A product with something watching it
shows what that check last said. A product with nothing watching it shows
"monitoring not connected", which is a statement about us and not about the
product, and is the thing to go and fix. There is no `unknown`.

**Median days to ship is not here.** It needs a request that names the release
that closed it, and at least three of them inside ninety days. Fewer than that
and a median is an artifact of when the factory started rather than a measure
of how fast it is, so the tick leaves it empty and says why.

**Revenue is not here** because no verified revenue source exists yet. A field
no row can fill is removed rather than shown blank: a missing capability
should make this page smaller, not fill it with dashes.

What shipped in full, in the words the public reads, is on
[Releases](/dashboard/p/releases). What is still owed is on
[Work](/dashboard/p/work); how many and how fast is on
[Performance](/dashboard/p/performance); what it cost is there too.
