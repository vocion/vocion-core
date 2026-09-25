Each row is a product a person answers for: its stage, its health, our price
beside the incumbent's dated list price, what last shipped and when, and what
is still owed with how much of it is moving. Stage and price are read from the
record; health, last shipped and open work are recomputed from the request and
release records underneath when work finishes, and the row says when.

**Health is a reading, not a guess.** A product with something watching it
shows what that check last said. A product with nothing watching it shows
"monitoring not connected", which is a statement about us and not about the
product, and is the thing to go and fix. There is no `unknown`.

**Revenue is not here** because no verified revenue source exists yet. A field
no row can fill is removed rather than shown blank: a missing capability
should make this page smaller, not fill it with dashes.

What shipped, in the words the public reads, is on
[Releases](/dashboard/p/releases). What is still owed is on
[Work](/dashboard/p/work).
