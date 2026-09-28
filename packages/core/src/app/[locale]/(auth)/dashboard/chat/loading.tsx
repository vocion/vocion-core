import { ConversationSkeleton } from '@/components/patterns/Skeletons';

/**
 * The chat surface while its roster, chips and (for `/chat/<id>`) the thread
 * load. The page IS the conversation, so the skeleton is a conversation:
 * two exchanges in the reading column and the composer at the bottom
 * (`patterns/Skeletons`). Neither route under here redirects on a normal
 * render; `/chat/<id>` 404s only on an id nobody is linked to.
 */
export default function ChatLoading() {
  return <ConversationSkeleton />;
}
