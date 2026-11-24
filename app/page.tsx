"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient, type Session } from "@supabase/supabase-js";

type BridgeMessage =
  | { source: "ldr-showcase"; type: "action"; name: string; args: unknown[]; seed: number; inputs: { i: number; value: string; checked: boolean }[] }
  | { source: "ldr-showcase"; type: "wordle-key"; key: string }
  | { source: "ldr-showcase"; type: "polaroid-position"; photoId: string; left: string; top: string; zIndex: string }
  | { source: "ldr-showcase"; type: "photo-created"; photo: { id: string; image: string; caption: string; dateLabel: string; rotation: number } }
  | { source: "ldr-showcase"; type: "photo-delete"; photoId: string }
  | { source: "ldr-showcase"; type: "local-photos"; photos: { id: string; image: string; caption: string; dateLabel: string; rotation: number }[] };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

function makeCode() {
  return Math.random().toString(36).slice(2, 9).toUpperCase();
}

type RoomPhoto = {
  id: string;
  storage_path: string;
  caption: string;
  date_label: string;
  rotation: number;
  position: { left?: string; top?: string; zIndex?: string } | null;
};

export default function Home() {
  const [supabase] = useState<SupabaseClient | null>(() =>
    supabaseUrl && supabaseKey
      ? createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        })
      : null
  );
  const [sessionReady, setSessionReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [room, setRoom] = useState("");
  const [roomId, setRoomId] = useState("");
  const [draft, setDraft] = useState("");
  const [player, setPlayer] = useState("");
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState("Not connected");
  const [online, setOnline] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const autoJoinAttempted = useRef(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const selfRef = useRef("");
  const restoringRef = useRef(false);

  useEffect(() => {
    if (!supabase) { setSessionReady(true); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setJoined(false);
        setRoom("");
        setRoomId("");
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    const savedName = localStorage.getItem("ldr-player-name");
    if (savedName) setPlayer(savedName);
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get("room");
    const savedRoom = inviteCode || localStorage.getItem("ldr-room-code");
    if (savedRoom) setDraft(savedRoom.toUpperCase());
  }, []);

  const sendToFrame = useCallback((message: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage({ ...message, source: "ldr-room" }, window.location.origin);
  }, []);

  const leaveRoom = useCallback(async (clearSaved = false) => {
    if (channelRef.current && supabase) await supabase.removeChannel(channelRef.current);
    channelRef.current = null;
    setJoined(false);
    setOnline([]);
    setFrameReady(false);
    setStatus("Not connected");
    if (clearSaved) {
      localStorage.removeItem("ldr-room-code");
      localStorage.removeItem("ldr-player-name");
    }
  }, [supabase]);

  const signInOrUp = async () => {
    if (!supabase) { setStatus("Add your Supabase URL and publishable key to .env.local."); return; }
    if (!email.trim() || password.length < 8) { setStatus("Enter a valid email and a password with at least 8 characters."); return; }
    setAuthBusy(true);
    setStatus(authMode === "signup" ? "Creating your account…" : "Signing in…");
    const result = authMode === "signup"
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setAuthBusy(false);
    if (result.error) { setStatus(result.error.message); return; }
    if (authMode === "signup" && !result.data.session) {
      setStatus("Account created. Check your email to confirm, then sign in.");
      setAuthMode("login");
      return;
    }
    setSession(result.data.session);
    setStatus("Signed in. Your session will be remembered on this device.");
  };

  const connectRoom = async (code: string, createNew = false) => {
    if (!supabase || !session?.user) return;
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
    const displayName = player.trim();
    if (!clean || !displayName) return;
    setStatus("Opening your shared space…");
    await leaveRoom(false);
    localStorage.setItem("ldr-player-name", displayName);
    localStorage.setItem("ldr-room-code", clean);

    const rpc = createNew
      ? await supabase.rpc("create_couple_room", { p_code: clean, p_display_name: displayName })
      : await supabase.rpc("join_couple_room", { p_code: clean, p_display_name: displayName });
    if (rpc.error) { setStatus(rpc.error.message); return; }
    const newRoomId = String(rpc.data);
    setRoom(clean);
    setDraft(clean);
    setRoomId(newRoomId);

    selfRef.current = crypto.randomUUID();
    const channel = supabase.channel(`ldr-couple-room:${newRoomId}`, {
      config: { broadcast: { self: false }, presence: { key: selfRef.current } },
    });
    channel
      .on("broadcast", { event: "room-event" }, ({ payload }) => {
        if (payload?.created_by === session.user.id) return;
        sendToFrame(payload?.event as Record<string, unknown>);
      })
      .on("broadcast", { event: "photo-added" }, ({ payload }) => {
        if (payload?.created_by === session.user.id) return;
        sendToFrame({ type: "photo-added", photo: payload.photo });
      })
      .on("broadcast", { event: "photo-removed" }, ({ payload }) => {
        if (payload?.created_by === session.user.id) return;
        sendToFrame({ type: "photo-removed", photoId: payload.photoId });
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string }>() as Record<string, { name: string }[]>;
        setOnline(Object.values(state).flat().map((p) => p.name).filter(Boolean));
      });
    channelRef.current = channel;
    channel.subscribe(async (state, err) => {
      if (state === "SUBSCRIBED") {
        await channel.track({ name: displayName, user_id: session.user.id });
        setJoined(true);
        setStatus("Connected · memories sync to your shared cloud space");
      } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
        setStatus(`Connection issue: ${err?.message || state}`);
      } else if (state === "CLOSED") setStatus("Room disconnected");
    });
  };

  useEffect(() => {
    if (!sessionReady || !profileReady || !session || !player.trim() || joined || autoJoinAttempted.current) return;
    const savedRoom = localStorage.getItem("ldr-room-code");
    if (!savedRoom) return;
    autoJoinAttempted.current = true;
    void connectRoom(savedRoom, false);
  }, [sessionReady, profileReady, session, player, joined]);

  const persistEvent = async (event: Record<string, unknown>) => {
    if (!supabase || !roomId || !session?.user || !channelRef.current) return;
    const eventType = String(event.type);
    const inserted = await supabase.from("room_events").insert({
      room_id: roomId, event_type: eventType, payload: event, created_by: session.user.id,
    });
    if (inserted.error) console.error("Could not save scrapbook action:", inserted.error.message);
    await channelRef.current.send({
      type: "broadcast",
      event: "room-event",
      payload: { event, created_by: session.user.id },
    });
  };

  const savePhoto = async (photo: BridgeMessage & { type: "photo-created" }) => {
    if (!supabase || !roomId || !session?.user) return;
    const raw = photo.photo.image;
    const base64 = raw.split(",")[1];
    if (!base64) return;
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const path = `${roomId}/${photo.photo.id}.jpg`;
    const upload = await supabase.storage.from("ldr-memories").upload(path, new Blob([bytes], { type: "image/jpeg" }), {
      contentType: "image/jpeg", upsert: true,
    });
    if (upload.error) { setStatus(`Photo upload failed: ${upload.error.message}`); return; }
    const row = await supabase.from("scrapbook_photos").upsert({
      id: photo.photo.id, room_id: roomId, storage_path: path,
      caption: photo.photo.caption, date_label: photo.photo.dateLabel,
      rotation: photo.photo.rotation, created_by: session.user.id,
    });
    if (row.error) { setStatus(`Photo record failed: ${row.error.message}`); return; }
    const signed = await supabase.storage.from("ldr-memories").createSignedUrl(path, 60 * 60 * 24 * 7);
    if (signed.data?.signedUrl) {
      await channelRef.current?.send({
        type: "broadcast", event: "photo-added",
        payload: { created_by: session.user.id, photo: { ...photo.photo, image: signed.data.signedUrl } },
      });
    }
    setStatus("Photo saved to your shared scrapbook ♥");
  };

  const deletePhoto = async (photoId: string) => {
    if (!supabase || !roomId || !session?.user) return;
    setStatus("Removing photo from your shared scrapbook…");
    const found = await supabase.from("scrapbook_photos")
      .select("storage_path").eq("id", photoId).eq("room_id", roomId).maybeSingle();
    if (found.error || !found.data) {
      setStatus(found.error?.message || "That photo could not be found.");
      return;
    }
    const removed = await supabase.from("scrapbook_photos")
      .delete().eq("id", photoId).eq("room_id", roomId);
    if (removed.error) {
      setStatus(`Could not delete photo: ${removed.error.message}`);
      return;
    }
    const storage = await supabase.storage.from("ldr-memories").remove([found.data.storage_path]);
    if (storage.error) console.error("Photo record deleted, but storage cleanup failed:", storage.error.message);
    sendToFrame({ type: "photo-removed", photoId });
    await channelRef.current?.send({
      type: "broadcast", event: "photo-removed",
      payload: { created_by: session.user.id, photoId },
    });
    setStatus(storage.error ? "Photo removed; cloud file cleanup needs attention." : "Photo deleted from both scrapbooks.");
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as BridgeMessage;
      if (data?.source !== "ldr-showcase") return;
      if (data.type === "photo-created") { void savePhoto(data); return; }
      if (data.type === "photo-delete") { void deletePhoto(data.photoId); return; }
      if (data.type === "local-photos") {
        for (const photo of data.photos || []) {
          void savePhoto({ source: "ldr-showcase", type: "photo-created", photo });
        }
        return;
      }
      if (data.type === "action" || data.type === "wordle-key" || data.type === "polaroid-position") {
        void persistEvent(data as unknown as Record<string, unknown>);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  useEffect(() => () => {
    if (channelRef.current && supabase) void supabase.removeChannel(channelRef.current);
  }, [supabase]);

  useEffect(() => {
    if (!joined || !frameReady || !supabase || !roomId) return;
    let cancelled = false;
    const restore = async () => {
      restoringRef.current = true;
      const [eventsResult, photosResult] = await Promise.all([
        supabase.from("room_events").select("payload").eq("room_id", roomId).order("id", { ascending: true }).limit(5000),
        supabase.from("scrapbook_photos").select("id,storage_path,caption,date_label,rotation,position").eq("room_id", roomId).order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      if (eventsResult.error) setStatus(`Could not restore shared activity: ${eventsResult.error.message}`);
      for (const photo of (photosResult.data || []) as RoomPhoto[]) {
        const signed = await supabase.storage.from("ldr-memories").createSignedUrl(photo.storage_path, 60 * 60 * 24 * 7);
        if (cancelled) return;
        if (signed.data?.signedUrl) {
          sendToFrame({
            type: "photo-added",
            photo: {
              id: photo.id, image: signed.data.signedUrl, caption: photo.caption,
              dateLabel: photo.date_label, rotation: photo.rotation,
              position: photo.position,
            },
          });
        }
      }
      
      
// Replay previous interactions, but skip old tab selections.
for (const row of eventsResult.data || []) {
  const event = row.payload as Record<string, unknown>;

  // Always start on Tab 1 instead of restoring an old selected tab.
  if (event.type === "action" && event.name === "switchTab") {
    continue;
  }

  sendToFrame(event);
}

      restoringRef.current = false;
    };
    void restore();
    return () => { cancelled = true; };
  }, [joined, frameReady, roomId, supabase, sendToFrame]);

  const copyInvite = async () => {
    const url = `${window.location.origin}/?room=${encodeURIComponent(room)}`;
    await navigator.clipboard.writeText(`Join our little world ♥\n${url}\nRoom code: ${room}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const logout = async () => {
    await leaveRoom(false);
    await supabase?.auth.signOut();
    localStorage.removeItem("ldr-room-code");
    setStatus("Signed out.");
  };

  if (!sessionReady) return <main className="entry-shell"><section className="entry-panel">Loading your saved session…</section></main>;

  if (!session) {
    return (
      <main className="entry-shell">
        <div className="entry-grain" aria-hidden="true" />
        <div className="entry-layout">
          <section className="entry-copy">
            <a className="wordmark" href="/"><span className="wordmark-symbol">m.</span><span>OUR LITTLE ELSEWHERE</span></a>
            <div className="entry-heading-wrap">
              <p className="intro-kicker">A place made for the two of you</p>
              <h1 className="entry-heading">Miles apart.<br/><em>Still close.</em></h1>
              <p className="entry-description">Your photos, notes and little rituals, safely kept in one shared place.</p>
            </div>
            <div className="entry-footnote"><span className="footnote-rule"/>Built for Arunava & Susmita <span className="footnote-heart">♥</span></div>
          </section>
          <section className="entry-panel">
            <div className="panel-topline"><span>{authMode === "login" ? "WELCOME BACK" : "MAKE YOUR ACCOUNT"}</span><span className="panel-edition">PRIVATE · JUST YOU TWO</span></div>
            <div className="panel-intro"><div className="panel-symbol">♡</div><h2>{authMode === "login" ? "Come back in." : "A little account for you."}</h2><p>Sign in to return to your saved room and memories.</p></div>
            <div className="entry-form">
              <label className="field-label" htmlFor="email">EMAIL</label>
              <input id="email" type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com"/>
              <label className="field-label field-label-room" htmlFor="password">PASSWORD <span>At least 8 characters</span></label>
              <input id="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={authMode === "login" ? "current-password" : "new-password"} placeholder="••••••••"/>
              <button onClick={signInOrUp} disabled={authBusy} className="button button-primary button-wide">{authBusy ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"} <span>↗</span></button>
              <button onClick={()=>setAuthMode(authMode === "login" ? "signup" : "login")} className="button button-secondary button-wide">{authMode === "login" ? "Create a new account" : "I already have an account"}</button>
            </div>
            <div className="connection-note" role="status"><span className="connection-indicator"/>{status}</div>
          </section>
        </div>
      </main>
    );
  }

  if (joined) {
    return (
      <main className="room-shell">
        <header className="room-topbar">
          <div className="brand-lockup"><div className="brand-mark">♥</div><div><div className="brand-title">Miles Apart, Still Us</div><div className="brand-subtitle">A shared little world for two</div></div></div>
          <div className="room-actions">
            <span className="room-chip">Room <b>{room}</b></span>
            <span className="status-chip"><i />{status}</span>
            <span className="online-chip">{online.length} here · {online.join(" & ")}</span>
            <button onClick={copyInvite} className="button button-primary">{copied ? "Copied!" : "Copy invite"}</button>
            <button onClick={()=>void leaveRoom(false)} className="button button-quiet">Leave room</button>
            <button onClick={logout} className="button button-quiet">Log out</button>
          </div>
        </header>
        <iframe
          ref={frameRef}
          title="Our shared LDR scrapbook and games"
          src="/showcase.html"
          onLoad={() => {
            setFrameReady(true);
            sendToFrame({ type: "export-local-photos" });
          }}
          className="room-frame"
          allow="camera; autoplay; clipboard-write"
        />
      </main>
    );
  }

  const savedRoom = typeof window !== "undefined" ? localStorage.getItem("ldr-room-code") : null;

  return (
    <main className="entry-shell">
      <div className="entry-grain" aria-hidden="true" />
      <div className="entry-layout">
        <section className="entry-copy">
          <a className="wordmark" href="/"><span className="wordmark-symbol">m.</span><span>OUR LITTLE ELSEWHERE</span></a>
          <div className="entry-heading-wrap">
            <p className="intro-kicker">Your shared space is waiting</p>
            <h1 className="entry-heading">Miles apart.<br/><em>Still close.</em></h1>
            <p className="entry-description">Sign in once. Your little world and the memories inside it will be waiting when you return.</p>
          </div>
          <div className="entry-footnote"><span className="footnote-rule"/>Built for Arunava & Susmita <span className="footnote-heart">♥</span></div>
        </section>
        <section className="entry-panel">
          <div className="panel-topline"><span>YOUR SHARED SPACE</span><span className="panel-edition">SIGNED IN</span></div>
          <div className="panel-intro"><div className="panel-symbol">♡</div><h2>Welcome back, {player || "you"}.</h2><p>Enter your shared room code, or return to the last room saved on this device.</p></div>
          <div className="entry-form">
            <label className="field-label" htmlFor="player-name">YOUR NAME</label>
            <input id="player-name" value={player} onChange={e=>setPlayer(e.target.value)} placeholder="Arunava or Susmita" maxLength={24}/>
            <label className="field-label field-label-room" htmlFor="room-code">ROOM CODE</label>
            <input id="room-code" value={draft} onChange={e=>setDraft(e.target.value.toUpperCase())} placeholder="Your private invite code" maxLength={24}/>
            <button onClick={()=>void connectRoom(draft)} disabled={!draft.trim() || !player.trim()} className="button button-primary button-wide">Open our scrapbook ↗</button>
            {savedRoom && <button onClick={()=>void connectRoom(savedRoom)} disabled={!player.trim()} className="button button-secondary button-wide">Return to saved room</button>}
            <button onClick={()=>void connectRoom(makeCode(), true)} disabled={!player.trim()} className="button button-secondary button-wide">Create a new shared room ＋</button>
          </div>
          <div className={`connection-note ${status.toLowerCase().includes("error") ? "connection-error" : ""}`} role="status"><span className="connection-indicator"/>{status}</div>
          <button onClick={logout} className="button button-quiet">Log out</button>
        </section>
      </div>
    </main>
  );
}
