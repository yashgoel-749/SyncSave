"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: {
    results: ArrayLike<{ isFinal: boolean; [index: number]: { transcript: string } }>;
  }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

export const MAX_DICTATION_CHARACTERS = 10_000;
const MAX_SESSION_MS = 90_000;
type Availability = "checking" | "available" | "unsupported" | "insecure" | "offline";
type Phase = "idle" | "starting" | "listening" | "stopping";

function getAvailability(): Availability {
  if (!window.isSecureContext) return "insecure";
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) return "unsupported";
  if (!navigator.onLine) return "offline";
  return "available";
}

function subscribeToConnectivity(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function recognitionError(error: string) {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied. Allow it in your browser settings, then try again.";
    case "audio-capture":
      return "No microphone is available. Connect one and check your browser settings.";
    case "network":
      return "The speech service could not connect. Check your internet connection and try again.";
    case "no-speech":
      return "No speech was detected. Click Start listening to try again.";
    case "language-not-supported":
      return "This speech service does not support the selected language. Try another language.";
    default:
      return "Speech recognition stopped. Your completed transcript is still available below.";
  }
}

export function useSpeechRecognition() {
  const availability = useSyncExternalStore(subscribeToConnectivity, getAvailability, () => "checking");
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const stopRequested = useRef(false);
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = useCallback(() => {
    if (sessionTimer.current) clearTimeout(sessionTimer.current);
    if (finishTimer.current) clearTimeout(finishTimer.current);
    sessionTimer.current = null;
    finishTimer.current = null;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    stopRequested.current = false;
    if (recognition) {
      recognition.onstart = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      try {
        recognition.abort();
      } catch {
        // Browsers may reject abort after the recognition service has already ended.
      }
    }
  }, []);

  const cancel = useCallback((message?: string) => {
    release();
    setPhase("idle");
    setInterim("");
    if (message) setError(message);
  }, [release]);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || stopRequested.current) return;
    stopRequested.current = true;
    setPhase("stopping");
    if (finishTimer.current) clearTimeout(finishTimer.current);
    // A stalled browser service must not keep the microphone session alive indefinitely.
    finishTimer.current = setTimeout(() => cancel(), 3_000);
    try {
      recognition.stop();
    } catch {
      cancel();
    }
  }, [cancel]);

  const start = useCallback((language: string) => {
    if (recognitionRef.current || getAvailability() !== "available") return;
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) return;
    if (transcript.length >= MAX_DICTATION_CHARACTERS) {
      setError("The preview is full. Insert or shorten it before dictating more.");
      return;
    }

    setError(null);
    setInterim("");
    setPhase("starting");
    try {
      const recognition = new Recognition();
      recognitionRef.current = recognition;
      recognition.lang = language;
      recognition.continuous = true;
      recognition.interimResults = true;
      const prefix = transcript.trim();
      const isCurrent = () => recognitionRef.current === recognition;

      recognition.onstart = () => {
        if (!isCurrent() || stopRequested.current) return;
        setPhase("listening");
        if (finishTimer.current) clearTimeout(finishTimer.current);
        finishTimer.current = null;
      };
      recognition.onresult = (event) => {
        if (!isCurrent()) return;
        const completed: string[] = [];
        const unfinished: string[] = [];
        // Results are cumulative within one session; rebuilding avoids inserting duplicates.
        for (let index = 0; index < event.results.length; index++) {
          const result = event.results[index];
          if (result[0]) (result.isFinal ? completed : unfinished).push(result[0].transcript);
        }
        const finalText = [prefix, ...completed].filter(Boolean).join(" ").trim();
        const interimText = unfinished.join(" ").trim();
        setTranscript(finalText.slice(0, MAX_DICTATION_CHARACTERS));
        setInterim(interimText.slice(0, Math.max(0, MAX_DICTATION_CHARACTERS - finalText.length)));
        if (finalText.length + interimText.length >= MAX_DICTATION_CHARACTERS) {
          setError("The 10,000-character preview limit was reached. Review your text before inserting.");
          stop();
        }
      };
      recognition.onerror = (event) => {
        if (isCurrent()) cancel(recognitionError(event.error));
      };
      recognition.onend = () => {
        if (isCurrent()) cancel();
      };
      finishTimer.current = setTimeout(() => {
        cancel("The microphone did not start. Check permissions and click Start listening to retry.");
      }, 15_000);
      sessionTimer.current = setTimeout(() => {
        setError("Listening paused after 90 seconds. Review your text or start another session.");
        stop();
      }, MAX_SESSION_MS);
      recognition.start();
    } catch {
      cancel("The microphone could not start. Check your browser permissions and try again.");
    }
  }, [cancel, stop, transcript]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && recognitionRef.current) cancel("Listening stopped because this tab is hidden.");
    };
    const onOffline = () => {
      if (recognitionRef.current) cancel("Listening stopped because the browser went offline.");
    };
    const onPageHide = () => cancel();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pagehide", onPageHide);
      release();
    };
  }, [cancel, release]);

  return { availability, phase, transcript, interim, error, start, stop, cancel, setTranscript };
}
