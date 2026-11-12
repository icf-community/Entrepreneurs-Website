import "server-only";
import { signedImageUrls } from "@/lib/storage/blobRead";
import type { FeedPost, MyPost, PostImage } from "@/lib/data/posts";

// ════════════════════════════════════════════════════════════════════
// Foundry · Turning stored blob keys into renderable image URLs
//
// post_images stores a container-relative key and nothing else, because
// a read URL is a short-expiry SAS that would be stale within the hour.
// So the URL is minted per render, here, at the boundary between the data
// layer and the components.
//
// Shared by the page and the "load more" action so both produce exactly
// the same shape — the client appends one to the other and must not be
// able to tell which came from where.
// ════════════════════════════════════════════════════════════════════

export type ImageView = {
  blobKey: string;
  url: string | null;
  altText: string;
  width: number;
  height: number;
};

export type FeedPostView = Omit<FeedPost, "images"> & { images: ImageView[] };
export type MyPostView = Omit<MyPost, "images"> & { images: ImageView[] };

type WithImages = { images: PostImage[] };

/**
 * Sign every image across a page of posts in one pass.
 *
 * Flattened deliberately: signing is batched so a page fetches the Azure
 * user delegation key at most once, rather than once per post. A slot
 * whose URL could not be minted comes back null and the card renders
 * without it — a missing image is a worse card, not a broken page.
 */
async function attach<T extends WithImages>(posts: T[]): Promise<(Omit<T, "images"> & { images: ImageView[] })[]> {
  const keys = posts.flatMap((p) => p.images.map((i) => i.blobKey));
  const urls = await signedImageUrls(keys);

  let cursor = 0;
  return posts.map((post) => {
    const images = post.images.map((image) => ({
      blobKey: image.blobKey,
      url: urls[cursor++] ?? null,
      altText: image.altText,
      width: image.width,
      height: image.height,
    }));
    return { ...post, images };
  });
}

export const toFeedView = (posts: FeedPost[]): Promise<FeedPostView[]> => attach(posts);
export const toMyPostView = (posts: MyPost[]): Promise<MyPostView[]> => attach(posts);
