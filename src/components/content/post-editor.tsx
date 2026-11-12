"use client";
import { useState } from "react";
import { GeneratedPost, SocialPlatform } from "@/types";
import { Modal, Input, Textarea, Select, Button } from "@/components/ui";
import { useStore } from "@/store/provider";
import { platforms } from "@/data/fixtures";
import { copyCaption, DownloadCreative, PostPreview } from "./post-card";
import { mockSchedulePost } from "@/lib/mock-api";
export function PostEditor({
  post,
  onClose,
}: {
  post: GeneratedPost;
  onClose: () => void;
}) {
  const { setState, toast } = useStore();
  const [draft, setDraft] = useState(post);
  const [date, setDate] = useState(post.scheduledAt || "");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  function save() {
    if (!draft.title.trim() || !draft.caption.trim()) {
      setError("Add a title and caption before saving.");
      return;
    }
    if (draft.status === "Scheduled" && !date) {
      setError("Choose a local date and time for this planned post.");
      return;
    }
    setState((s) => ({
      ...s,
      posts: s.posts.map((p) =>
        p.id === draft.id
          ? {
              ...draft,
              scheduledAt: draft.status === "Scheduled" ? date : undefined,
              updatedAt: new Date().toISOString(),
            }
          : p,
      ),
    }));
    toast("Post updated in this browser.");
    onClose();
  }
  return (
    <>
      <Modal
        open
        onOpenChange={(o) => !o && onClose()}
        title="A little fine-tuning"
        description="Edit your draft or plan a local demo schedule. No content is published."
      >
        <div className="editor-modal-grid">
          <div>
            <Input
              label="Post title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <Textarea
              label="Caption"
              rows={5}
              value={draft.caption}
              onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
            />
            <Textarea
              label="Hashtags"
              value={draft.hashtags}
              onChange={(e) => setDraft({ ...draft, hashtags: e.target.value })}
            />
            <div className="form-grid">
              <Select
                label="Platform"
                value={draft.platform}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    platform: e.target.value as SocialPlatform,
                  })
                }
              >
                {platforms.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
              <Select
                label="Status · demo simulation"
                value={draft.status}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    status: e.target.value as GeneratedPost["status"],
                  })
                }
              >
                {["Draft", "Scheduled", "Published"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
            <Input
              label={`Planned date & time · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="wrap-actions">
              <Button onClick={save}>Save changes</Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  if (!date) {
                    setError("Choose a date and time first.");
                    return;
                  }
                  const scheduled = await mockSchedulePost(draft, date);
                  setState((s) => ({
                    ...s,
                    posts: s.posts.map((p) =>
                      p.id === draft.id ? scheduled : p,
                    ),
                  }));
                  toast("Post planned locally. No publishing will occur.");
                  onClose();
                }}
              >
                Plan locally
              </Button>
              <Button
                variant="secondary"
                onClick={() => copyCaption(draft, toast)}
              >
                Copy caption
              </Button>
              <DownloadCreative post={draft} />
              <Button
                variant="ghost"
                onClick={() => {
                  setState((s) => ({
                    ...s,
                    posts: [
                      {
                        ...draft,
                        id: crypto.randomUUID(),
                        title: `${draft.title} (copy)`,
                        status: "Draft",
                        scheduledAt: undefined,
                        updatedAt: new Date().toISOString(),
                      },
                      ...s.posts,
                    ],
                  }));
                  toast("Draft duplicated.");
                  onClose();
                }}
              >
                Duplicate
              </Button>
              <Button variant="danger" onClick={() => setConfirm(true)}>
                Delete post
              </Button>
            </div>
          </div>
          <PostPreview post={draft} />
        </div>
      </Modal>
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this post?"
        description="This removes the post and its local schedule from this browser."
      >
        <div className="wrap-actions">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Keep post
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setState((s) => ({
                ...s,
                posts: s.posts.filter((p) => p.id !== post.id),
              }));
              toast("Post deleted.");
              onClose();
            }}
          >
            Delete post
          </Button>
        </div>
      </Modal>
    </>
  );
}
