---
slug: publish-page
name: Publishing an approved page
description: >-
  An approved page goes to the client's site through the project's publish
  target, always as a proposal a person approves: a pull request on a
  repository, a draft post on Squarespace. Never a page that is not approved.
  Read before publishing.
version: 2
---

# Publishing an approved page

Only a page a person signed off is published. The page's status says
`approved`; if it does not, stop and say what it is waiting on.

1. Read the project's publish targets ("Publishes to"). The page's
   `publishTargetId`, or the batch's destination, names which one. With no
   target, ask the person where the page goes; never guess a repository or a
   site.
2. A page's workflow run publishes it itself, right after the person signs
   it off: `site.publish_page` runs on that sign-off with no second card.
   Outside a run, propose `site.publish_page` with the page; it runs on the
   page's sign-off, and anything not signed off waits on its card.
   - A repository: one commit on its own branch and a pull request. Nobody
     merges it but the client's own people.
   - Squarespace: a browser run saves the post as a draft. Going live is
     `site.publish_live` with the drafted pages, one card for all of them.
3. The pull request or post URL and, once live, the live URL are recorded on
   the page. Tell the person where it is, with the link.

If the workspace cannot publish to that kind of site yet, say so plainly and
hand the person the approved draft instead.
