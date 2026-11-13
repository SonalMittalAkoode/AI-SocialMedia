"use client";
import { GeneratedPost } from "@/types";
import { Badge, Button } from "@/components/ui";
import {
  ArrowUpRight,
  Coffee,
  Heart,
  MessageCircle,
  Bookmark,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
import { useStore } from "@/store/provider";
export function Creative({
  variant = 0,
  title,
  compact = false,
}: {
  variant?: number;
  title?: string;
  compact?: boolean;
}) {
  const { state } = useStore();
  return (
    <div
      className={`creative creative-${variant % 3} ${compact ? "creative-compact" : ""}`}
    >
      <div className="creative-brand">
        {state.workspace.company.name.toUpperCase()} <span>DEMO CREATIVE</span>
      </div>
      <div className="creative-copy">
        {title ||
          [
            "A little pause.\nA better day.",
            "Make room\nfor slow.",
            "Good coffee.\nGreat ideas.",
          ][variant % 3]}
      </div>
      <div className="coffee-scene">
        <div className="coffee-shadow" />
        <div className="coffee-handle" />
        <div className="coffee-cup">
          <div className="coffee-liquid">
            <span>✺</span>
          </div>
        </div>
        <div className="coffee-bean bean-one" />
        <div className="coffee-bean bean-two" />
      </div>
      <span className="creative-footer">YOUR DAILY DOSE OF GOOD.</span>
      <Coffee className="creative-icon" size={20} />
    </div>
  );
}
export function PostCard({
  post,
  onEdit,
  onPreview,
}: {
  post: GeneratedPost;
  onEdit?: () => void;
  onPreview?: () => void;
}) {
  return (
    <article className="post-card">
      <button
        className="post-creative-button"
        onClick={onPreview || onEdit}
        aria-label={`Preview ${post.title}`}
      >
        <Creative variant={post.creative} />
      </button>
      <div className="post-card-body">
        <div className="row-between">
          <span className="platform-label">{post.platform}</span>
          <Badge
            tone={
              post.status === "Draft"
                ? "neutral"
                : post.status === "Scheduled"
                  ? "pink"
                  : "green"
            }
          >
            {post.status}
            {post.status !== "Draft" ? " · Demo" : ""}
          </Badge>
        </div>
        <h3>{post.title}</h3>
        <p>
          {post.category} <span>·</span>{" "}
          {new Date(post.updatedAt).toLocaleDateString("en-IN", {
            month: "short",
            day: "numeric",
          })}
        </p>
        {onEdit && (
          <button className="text-button" onClick={onEdit}>
            Edit post <ArrowUpRight size={14} />
          </button>
        )}
      </div>
    </article>
  );
}
export function PostPreview({ post }: { post: GeneratedPost }) {
  const { state } = useStore();
  return (
    <div className={`social-preview preview-${post.platform}`}>
      <div className="preview-head">
        <div className="brand-avatar">
          {state.workspace.company.name.slice(0, 1)}
        </div>
        <div>
          <strong>{state.workspace.company.name}</strong>
          <small>{post.platform} · Preview</small>
        </div>
        <MoreHorizontal size={20} />
      </div>
      {post.platform === "X" && (
        <p className="preview-caption">{post.caption}</p>
      )}
      <Creative variant={post.creative} title={post.title} />
      <div className="preview-bottom">
        {post.platform === "Instagram" && (
          <div className="preview-reactions">
            <Heart size={20} />
            <MessageCircle size={20} />
            <Bookmark size={20} />
          </div>
        )}
        {post.platform !== "X" && (
          <p className="preview-caption">{post.caption}</p>
        )}
        <p className="hashtags">{post.hashtags}</p>
        <div className="row-between">
          <small>Platform-inspired preview</small>
          <Badge tone="green">
            <Sparkles size={11} /> Brand aligned · illustrative
          </Badge>
        </div>
      </div>
    </div>
  );
}
export async function copyCaption(
  post: GeneratedPost,
  toast: (message: string) => void,
) {
  try {
    await navigator.clipboard.writeText(`${post.caption}\n\n${post.hashtags}`);
    toast("Caption copied to clipboard.");
  } catch {
    toast("Clipboard unavailable. Select and copy the caption manually.");
  }
}
export function DownloadCreative({ post }: { post: GeneratedPost }) {
  const { toast } = useStore();
  return (
    <Button
      variant="secondary"
      onClick={() => {
        const escape = (s: string) =>
          s.replace(
            /[<>&"']/g,
            (c) =>
              ({
                "<": "&lt;",
                ">": "&gt;",
                "&": "&amp;",
                '"': "&quot;",
                "'": "&apos;",
              })[c] || c,
          );
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="#d9c6aa"/><text x="80" y="100" fill="#39281d" font-family="Georgia" font-size="28">SOCIALAI · DEMO CREATIVE</text><foreignObject x="80" y="200" width="920" height="500"><div xmlns="http://www.w3.org/1999/xhtml" style="font:90px Georgia;color:#39281d">${escape(post.title)}</div></foreignObject><circle cx="750" cy="800" r="170" fill="#f3eadc"/><circle cx="750" cy="800" r="130" fill="#65432c"/></svg>`;
        const url = URL.createObjectURL(
          new Blob([svg], { type: "image/svg+xml" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "socialai-creative.svg";
        a.click();
        URL.revokeObjectURL(url);
        toast("SVG creative downloaded.");
      }}
    >
      Download SVG
    </Button>
  );
}
