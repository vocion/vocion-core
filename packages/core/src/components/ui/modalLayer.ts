import * as React from 'react';

/**
 * TRUE INSIDE A SCROLL-LOCKED LAYER (a sheet or a dialog).
 *
 * A modal sheet locks scrolling to its own content, and a popover portals its
 * content to `<body>`, outside that content. So a popover opened inside the
 * phone's sidebar drawer could not be scrolled by touch: the drawer's lock
 * swallowed every touchmove on the list (founder, 2026-10-09, the workspace
 * picker on an iPhone). A popover inside such a layer is therefore modal
 * itself (`popover.tsx`): its own lock stacks on top of the layer's, and only
 * the top lock decides, so the popover's list scrolls and the page under it
 * still does not.
 */
export const ModalLayerContext = React.createContext(false);
