import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Bell, Check, FileText, LockKeyhole, MessageSquareText, Paperclip, Send, ShieldBan, ShieldCheck, Trash2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest, ApiError } from "../lib/api";
import { supabase } from "../lib/supabase";
import { PageHeading } from "../components/WorkspacePrimitives";

type Conversation = {
  id: string; projectId: string; projectTitle: string; participantRole: "client" | "freelancer";
  otherDisplayName: string; lastMessagePreview: string; unreadCount: number; lastMessageAt: string | null;
  createdAt: string; blockedByMe: boolean; blockedByOther: boolean;
};
type Attachment = { path: string; fileName: string };
type Message = {
  id: string; body: string; attachments: Attachment[]; createdAt: string;
  isMine: boolean; senderDisplayName: string; readByOther: boolean;
};
type Notification = {
  id: string; conversationId: string; projectId: string; projectTitle: string;
  actorDisplayName: string; messagePreview: string; createdAt: string; readAt: string | null;
};
type UploadedFile = { key: string; path: string; fileName: string };

const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"]);
const maximumFileSize = 10 * 1024 * 1024;

export function MessagesPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedId, setSelectedId] = useState(searchParams.get("conversationId"));
  const [tab, setTab] = useState<"messages" | "notifications">(window.location.hash === "#notifications" ? "notifications" : "messages");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [searchText, setSearchText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [reportReason, setReportReason] = useState("other");
  const [reportDetails, setReportDetails] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [realtime, setRealtime] = useState<"connecting" | "connected" | "unavailable">("unavailable");
  const pendingSendKeys = useRef(new Map<string, string>());
  const conversation = conversations.find((item) => item.id === selectedId) ?? null;

  const refreshConversations = useCallback(async () => {
    const response = await apiRequest<{ conversations: Conversation[] }>("/api/conversations");
    setConversations(response.conversations);
  }, []);

  const refreshNotifications = useCallback(async () => {
    const response = await apiRequest<{ notifications: Notification[]; unreadCount: number }>("/api/notifications");
    setNotifications(response.notifications);
    setUnreadCount(response.unreadCount);
    window.dispatchEvent(new Event("proofpay:notifications:refresh"));
  }, []);

  const refreshMessages = useCallback(async () => {
    if (!selectedId) { setMessages([]); return; }
    const response = await apiRequest<{ messages: Message[] }>(`/api/conversations/${selectedId}/messages`);
    setMessages(response.messages);
    await apiRequest(`/api/conversations/${selectedId}/read`, { method: "POST" });
    await Promise.all([refreshConversations(), refreshNotifications()]);
  }, [selectedId, refreshConversations, refreshNotifications]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let active = true;
    void Promise.all([refreshConversations(), refreshNotifications()]).catch((cause) => {
      if (active) setError(cause instanceof ApiError ? cause.message : "Messages could not be loaded.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, refreshConversations, refreshNotifications]);

  useEffect(() => {
    const projectId = searchParams.get("projectId");
    if (!user || !projectId) return;
    let active = true;
    setBusy(true); setError("");
    void apiRequest<{ conversationId: string }>("/api/conversations", { method: "POST", body: { projectId } })
      .then(async (result) => {
        if (!active) return;
        setSelectedId(result.conversationId);
        setSearchParams({ conversationId: result.conversationId }, { replace: true });
        await refreshConversations();
      }).catch((cause) => {
        if (active) setError(cause instanceof ApiError ? cause.message : "This project conversation is unavailable.");
      }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [user, searchParams, setSearchParams, refreshConversations]);

  useEffect(() => {
    if (location.hash === "#notifications") setTab("notifications");
  }, [location.hash]);

  useEffect(() => {
    if (!user || searchParams.get("projectId")) return;
    const requestedId = searchParams.get("conversationId");
    if (requestedId) setSelectedId(requestedId);
  }, [user, searchParams]);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    let active = true;
    setError("");
    void refreshMessages().catch((cause) => {
      if (active) setError(cause instanceof ApiError ? cause.message : "This conversation could not be loaded.");
    });
    return () => { active = false; };
  }, [selectedId, refreshMessages]);

  useEffect(() => {
    const storageClient = supabase;
    if (!storageClient || !selectedId) { setRealtime("unavailable"); return; }
    setRealtime("connecting");
    const channel = storageClient.channel(`proofpay-project-conversation-${selectedId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "project_messages", filter: `conversation_id=eq.${selectedId}` }, () => {
        void refreshMessages().catch(() => setError("A new message arrived, but the latest history could not be refreshed."));
      })
      .subscribe((status) => setRealtime(status === "SUBSCRIBED" ? "connected" : "unavailable"));
    return () => { void storageClient.removeChannel(channel); };
  }, [selectedId, refreshMessages]);

  const selectConversation = (id: string) => {
    setSelectedId(id); setTab("messages"); setSearchParams({ conversationId: id });
  };

  const onChooseFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    const currentKeys = new Set([...files.map(fileKey), ...uploadedFiles.map((item) => item.key)]);
    const unique = picked.filter((file) => !currentKeys.has(fileKey(file)));
    if (currentKeys.size + unique.length > 5) { setError("Attach up to five files to one message."); return; }
    if (unique.some((file) => !allowedMimeTypes.has(file.type) || file.size < 1 || file.size > maximumFileSize)) {
      setError("Use PDF, JPEG, PNG, WebP, or plain text files up to 10 MB each."); return;
    }
    setError(""); setFiles((current) => [...current, ...unique]);
  };

  const removeFile = async (key: string) => {
    const uploaded = uploadedFiles.find((item) => item.key === key);
    if (uploaded && supabase) {
      const { error: deleteError } = await supabase.storage.from("conversation-attachments").remove([uploaded.path]);
      if (deleteError) { setError("That uploaded draft attachment could not be removed. It remains private and unattached to a message."); return; }
    }
    setFiles((current) => current.filter((file) => fileKey(file) !== key));
    setUploadedFiles((current) => current.filter((item) => item.key !== key));
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!conversation || busy || conversation.blockedByMe || conversation.blockedByOther) return;
    const body = messageText.trim();
    if (!body && new Set([...files.map(fileKey), ...uploadedFiles.map((item) => item.key)]).size === 0) { setError("Write a message or attach a file."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const storageClient = supabase;
      if ((files.length || uploadedFiles.length) && !storageClient) throw new Error("Private attachment storage is not configured.");
      let stored = [...uploadedFiles];
      for (const file of files) {
        const key = fileKey(file);
        if (stored.some((item) => item.key === key)) continue;
        const safeName = file.name.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/[ .]+$/g, "").slice(0, 140) || "attachment";
        const path = `${conversation.id}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await storageClient!.storage.from("conversation-attachments").upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw new Error(uploadError.message);
        stored = [...stored, { key, path, fileName: safeName }];
        setUploadedFiles(stored);
      }
      const attachments = stored.map(({ path, fileName }) => ({ path, fileName }));
      const fingerprint = JSON.stringify({ body, attachments });
      const idempotencyKey = pendingSendKeys.current.get(fingerprint) ?? crypto.randomUUID();
      pendingSendKeys.current.set(fingerprint, idempotencyKey);
      await apiRequest(`/api/conversations/${conversation.id}/messages`, {
        method: "POST", body: { idempotencyKey, body, attachments },
      });
      pendingSendKeys.current.delete(fingerprint); setMessageText(""); setFiles([]); setUploadedFiles([]);
      setNotice("Message sent to the other project participant.");
      try { await refreshMessages(); }
      catch { setNotice("Message was saved, but the conversation list could not refresh. Reload this page to check the latest history."); }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : "The message could not be sent. Retry the same text and files to safely reuse its send key.");
    } finally { setBusy(false); }
  };

  const changeBlock = async () => {
    if (!conversation) return;
    setBusy(true); setError("");
    try {
      await apiRequest(`/api/conversations/${conversation.id}/block`, { method: "POST", body: { action: conversation.blockedByMe ? "unblock" : "block" } });
      await refreshConversations();
      setNotice(conversation.blockedByMe ? "Messaging is available again for this project." : "New messages in this conversation are now blocked in both directions.");
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Block setting could not be updated."); }
    finally { setBusy(false); }
  };

  const reportConversation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!conversation) return;
    setBusy(true); setError("");
    try {
      await apiRequest(`/api/conversations/${conversation.id}/reports`, { method: "POST", body: { messageId: null, reason: reportReason, details: reportDetails } });
      setReportDetails(""); setNotice("Your report was recorded for review. No automatic decision was made.");
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "The report could not be submitted."); }
    finally { setBusy(false); }
  };

  const markNotificationRead = async (notification: Notification) => {
    try {
      if (!notification.readAt) await apiRequest(`/api/notifications/${notification.id}/read`, { method: "POST" });
      setSelectedId(notification.conversationId); setTab("messages"); setSearchParams({ conversationId: notification.conversationId });
      await refreshNotifications();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Notification could not be opened."); }
  };

  if (!user) return <>
    <PageHeading eyebrow="PROJECT MESSAGING" title="Messages" description="Private project conversations, read history, and notifications." />
    <section className="messages-auth-card"><span><LockKeyhole size={19} /></span><h2>Sign in to view project conversations.</h2><p>Messages are visible only to members of the related project. No sample conversations are displayed here.</p><Link to="/signin" className="button-primary">Sign in to continue <ArrowUpRight size={14} /></Link></section>
  </>;

  const visibleMessages = messages.filter((message) => !searchText || message.body.toLocaleLowerCase().includes(searchText.trim().toLocaleLowerCase()));
  const unreadNotifications = unreadCount;

  return <>
    <PageHeading eyebrow="PROJECT MESSAGING" title="Messages" description="Keep project decisions, file handoffs, and notifications in the project workspace." />
    <p className="messages-security-note"><LockKeyhole size={14} /> Project members only · App messages do not change agreement, milestone, or PayPal payment state.</p>
    {error && <p role="alert" className="messages-feedback is-error"><AlertTriangle size={14} />{error}</p>}
    {notice && <p role="status" className="messages-feedback"><Check size={14} />{notice}</p>}
    <div className="messages-workspace">
      <aside className="messages-sidebar">
        <div className="messages-tabs" role="tablist" aria-label="Message sections">
          <button type="button" role="tab" aria-selected={tab === "messages"} className={tab === "messages" ? "active" : ""} onClick={() => setTab("messages")}><MessageSquareText size={14} /> Messages</button>
          <button type="button" role="tab" aria-selected={tab === "notifications"} className={tab === "notifications" ? "active" : ""} onClick={() => setTab("notifications")}><Bell size={14} /> Updates {unreadNotifications > 0 && <b>{unreadNotifications}</b>}</button>
        </div>
        {tab === "messages" ? <div className="messages-conversation-list">
          {loading ? <p className="messages-empty-inline">Loading conversations…</p> : conversations.length === 0 ? <div className="messages-empty-inline"><strong>No conversations yet</strong><span>Open a project and start its private conversation with the other member.</span><Link to="/app/projects">View projects <ArrowUpRight size={12} /></Link></div> : conversations.map((item) => <button type="button" key={item.id} className={`messages-conversation-row${item.id === selectedId ? " selected" : ""}`} onClick={() => selectConversation(item.id)}>
            <span className="messages-avatar">{initials(item.otherDisplayName)}</span><span className="messages-conversation-copy"><strong>{item.otherDisplayName}</strong><small>{item.projectTitle}</small><span>{item.lastMessagePreview || "Start a project conversation"}</span></span>{item.unreadCount > 0 && <b className="messages-unread-count">{item.unreadCount}</b>}
          </button>)}
        </div> : <div className="messages-notification-list" id="notifications">
          {unreadCount > notifications.filter((notification) => !notification.readAt).length && <p className="messages-empty-inline">Showing the latest notifications. There are {unreadCount} unread in total.</p>}
          {notifications.length === 0 ? <p className="messages-empty-inline">No project-message notifications yet.</p> : notifications.map((item) => <button type="button" key={item.id} className={`messages-notification-row${item.readAt ? "" : " unread"}`} onClick={() => void markNotificationRead(item)}>
            <span className="messages-notification-icon"><Bell size={14} /></span><span><strong>{item.actorDisplayName} · {item.projectTitle}</strong><small>{item.messagePreview || "Sent an attachment"}</small><time>{formatDateTime(item.createdAt)}</time></span>{!item.readAt && <i aria-label="Unread" />}
          </button>)}
        </div>}
      </aside>

      <section className="messages-thread" aria-label="Project conversation">
        {conversation ? <>
          <header className="messages-thread-header"><div><span className="messages-thread-eyebrow">{conversation.participantRole === "client" ? "CLIENT VIEW" : "FREELANCER VIEW"} · PROJECT CONVERSATION</span><h2>{conversation.projectTitle}</h2><p>With {conversation.otherDisplayName}</p></div><div className="messages-thread-actions"><button type="button" className="button-secondary" disabled={busy} onClick={() => void changeBlock()}><ShieldBan size={14} />{conversation.blockedByMe ? "Unblock" : "Block"}</button><Link to={`/app/projects/${conversation.projectId}`} className="messages-project-link">Project details <ArrowUpRight size={13} /></Link></div></header>
          <div className="messages-thread-status"><span className={realtime === "connected" ? "connected" : ""} />{realtime === "connected" ? "Live updates connected" : realtime === "connecting" ? "Connecting live updates…" : "Live updates unavailable"}<span>{messages.length} recent messages</span><button type="button" onClick={() => void refreshMessages().catch(() => setError("Conversation history could not be refreshed."))}>Refresh</button></div>
          <label className="messages-search">Search recent messages<input value={searchText} maxLength={120} placeholder="Search this conversation" onChange={(event) => setSearchText(event.currentTarget.value)} /></label>
          <div className="messages-history" aria-live="polite">
            {visibleMessages.length === 0 ? <p className="messages-empty-inline">{searchText ? "No recent messages match that search." : "No messages yet. Start with the next project step or a clear question."}</p> : visibleMessages.map((message) => <article className={`message-bubble${message.isMine ? " mine" : ""}`} key={message.id}>
              {!message.isMine && <strong>{message.senderDisplayName}</strong>}
              {message.body && <p>{message.body}</p>}
              {message.attachments.map((attachment) => <PrivateAttachment key={attachment.path} attachment={attachment} />)}
              <small>{formatDateTime(message.createdAt)}{message.isMine && message.readByOther ? " · Seen" : ""}</small>
            </article>)}
          </div>
          {conversation.blockedByMe || conversation.blockedByOther ? <p className="messages-blocked-note"><ShieldBan size={15} />{conversation.blockedByMe ? "You blocked new messages in this conversation. Unblock to continue." : "The other participant has blocked new messages in this conversation."}</p> : <form className="messages-composer" onSubmit={(event) => void sendMessage(event)}>
            {files.length + uploadedFiles.length > 0 && <div className="messages-pending-files">{[...files.map((file) => ({ key: fileKey(file), fileName: file.name })), ...uploadedFiles.filter((item) => !files.some((file) => fileKey(file) === item.key))].map((file) => <span key={file.key}><FileText size={13} />{file.fileName}<button type="button" aria-label={`Remove ${file.fileName}`} onClick={() => void removeFile(file.key)}><Trash2 size={13} /></button></span>)}</div>}
            <textarea value={messageText} maxLength={5000} placeholder="Write a project message…" aria-label="Write a project message" onChange={(event) => setMessageText(event.currentTarget.value)} />
            <div><label className="messages-attach-button"><Paperclip size={14} />Attach file<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,text/plain" multiple onChange={onChooseFiles} /></label><small>PDF, JPG, PNG, WebP, TXT · up to 10 MB each</small><button type="submit" className="button-primary" disabled={busy || (!messageText.trim() && new Set([...files.map(fileKey), ...uploadedFiles.map((item) => item.key)]).size === 0)}>{busy ? "Sending…" : "Send message"}<Send size={14} /></button></div>
          </form>}
          <form className="messages-report-form" onSubmit={(event) => void reportConversation(event)}><details><summary><AlertTriangle size={13} /> Report an issue with this conversation</summary><label>Reason<select value={reportReason} onChange={(event) => setReportReason(event.currentTarget.value)}><option value="harassment">Harassment</option><option value="spam">Spam</option><option value="unsafe_attachment">Unsafe attachment</option><option value="other">Other</option></select></label><label>Details<textarea value={reportDetails} maxLength={2000} onChange={(event) => setReportDetails(event.currentTarget.value)} /></label><button type="submit" className="button-secondary" disabled={busy}>Submit private report</button></details></form>
        </> : <div className="messages-thread-empty"><span><MessageSquareText size={21} /></span><h2>Project conversations stay with the work.</h2><p>Select a project conversation or open one from a project detail page. Only its members can read or send messages.</p>{!loading && conversations.length > 0 && <p><ShieldCheck size={14} /> Your conversations are private to their project members.</p>}</div>}
      </section>
    </div>
  </>;
}

function PrivateAttachment({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    if (!supabase) { setError(true); return; }
    void supabase.storage.from("conversation-attachments").createSignedUrl(attachment.path, 60)
      .then(({ data, error: signedError }) => {
        if (!active) return;
        if (signedError || !data?.signedUrl) setError(true);
        else setUrl(data.signedUrl);
      }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [attachment.path]);
  if (error) return <span className="message-attachment unavailable"><LockKeyhole size={13} />Private file unavailable</span>;
  if (!url) return <span className="message-attachment"><FileText size={13} />Preparing private file…</span>;
  return <a className="message-attachment" href={url} target="_blank" rel="noreferrer" referrerPolicy="no-referrer"><FileText size={13} />{attachment.fileName}<ArrowUpRight size={12} /></a>;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "PP";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
