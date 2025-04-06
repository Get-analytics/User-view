import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Player,
  ControlBar,
  BigPlayButton,
  VolumeMenuButton,
  CurrentTimeDisplay,
  DurationDisplay,
  TimeDivider,
  PlaybackRateMenuButton,
} from "video-react";
import "video-react/dist/video-react.css";
import { useUser } from "../../context/Usercontext";

const VideoWithAdvancedFeatures = ({ url, mimeType }) => {
  // -------------------- User Context & Identification --------------------
  const { ip, location, userId, region, os, device, browser } = useUser();
  console.log(ip, location, userId, region, os, device, browser, "user context data");
  console.log(window.location.pathname, "videoId from path");

  const apiCalledRef = useRef(false);
  const sendIdentificationRequest = useCallback(async () => {
    if (!userId || !window.location.pathname) return;
    const documentId = window.location.pathname.split("/").pop();
    const requestData = { userId, documentId, mimeType: "video" };

    try {
      const response = await fetch("https://filescene.onrender.com/api/user/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData),
      });
      if (!response.ok) {
        throw new Error("Failed to identify user");
      }
      const result = await response.json();
      console.log("User identification successful:", result);
    } catch (error) {
      console.error("Error sending identification request:", error);
    }
  }, [userId]);

  useEffect(() => {
    if (userId && userId.length > 15 && !apiCalledRef.current) {
      const timer = setTimeout(() => {
        sendIdentificationRequest();
        apiCalledRef.current = true;
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [userId, sendIdentificationRequest]);

  // refresh state addedd

    useEffect(() => {
    const url = new URL(window.location.href);
    // Check if the "refreshed" parameter is absent.
    if (!url.searchParams.get("refreshed")) {
      url.searchParams.set("refreshed", "true");
      window.location.replace(url.toString());
    }
  }, []);

  // -------------------- Video & Analytics Setup --------------------
  const playerRef = useRef(null);
  const [videoEl, setVideoEl] = useState(null); // HTMLVideoElement
  const [playedSeconds, setPlayedSeconds] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Analytics state – includes accumulated totalWatchTime and currentPlayStart
  const [analytics, setAnalytics] = useState({
    totalWatchTime: 0,
    playCount: 0,
    pauseCount: 0,
    seekCount: 0,
    pauseResumeEvents: [], // { pauseTime, resumeTime }
    skipEvents: [],        // { from, to } for seeks or drags
    jumpEvents: [],        // { type, from, to } for 10-sec jumps
    speedEvents: [],       // { speed, startTime, endTime }
    currentSpeedEvent: null,
    fullscreenEvents: [],  // { entered, exited }
    download: false,
    currentPlayStart: null, // The timestamp when continuous playback began
  });

  // New state for the user's entry time (set only once)
  const [entryTime, setEntryTime] = useState(null);
  useEffect(() => {
    if (!entryTime) {
      setEntryTime(new Date().toISOString());
    }
  }, [entryTime]);

  const backendUrl = "https://filescene.onrender.com/api/v1/video/analytics";

  // Helper: Format seconds nicely.
  const formatTime = (seconds) => {
    seconds = Math.floor(seconds);
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    else if (mins > 0) return `${mins}m ${secs}s`;
    else return `${secs}s`;
  };

  // A ref to always hold the latest analytics state.
  const analyticsRef = useRef(analytics);
  useEffect(() => {
    analyticsRef.current = analytics;
  }, [analytics]);

  // Refs for tracking previous times and dragging
  const prevTimeRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartTime, setDragStartTime] = useState(null);
  // A flag to mark if a jump (10-sec forward/backward) was triggered.
  const jumpTriggeredRef = useRef(false);

  // -------------------- Centralized Watch Time Updater --------------------
  // Updates totalWatchTime based on the elapsed time from currentPlayStart to newTime.
  // If isPlaying is true, we reset currentPlayStart to newTime; otherwise, we clear it.
  const updateWatchTime = (newTime, isPlaying = true) => {
    setAnalytics((prev) => {
      let segmentTime = 0;
      if (prev.currentPlayStart !== null && newTime >= prev.currentPlayStart) {
        segmentTime = newTime - prev.currentPlayStart;
      }
      return {
        ...prev,
        totalWatchTime: prev.totalWatchTime + segmentTime,
        currentPlayStart: isPlaying ? newTime : null,
      };
    });
  };

  // -------------------- Periodic playedSeconds Update --------------------
  useEffect(() => {
    const interval = setInterval(() => {
      if (playerRef.current && playerRef.current.getState) {
        const time = playerRef.current.getState().player.currentTime;
        setPlayedSeconds(time);
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (videoDuration > 0) {
      console.log(`Total video duration: ${videoDuration} seconds`);
    }
  }, [videoDuration]);

  useEffect(() => {
    if (videoEl) {
      videoEl.playbackRate = playbackRate;
    }
  }, [playbackRate, videoEl]);

  // -------------------- Playback Event Handlers --------------------
  const handlePlay = () => {
    if (!videoEl) return;
    const currentTime = videoEl.currentTime;
    console.log("Play event at:", currentTime);
    // When playing, simply start a new continuous segment.
    setAnalytics((prev) => ({
      ...prev,
      playCount: prev.playCount + 1,
      // If resuming from a pause, currentPlayStart might be null, so start here.
      currentPlayStart: currentTime,
    }));
  };

  const handlePause = () => {
    if (!videoEl) return;
    const currentTime = videoEl.currentTime;
    console.log("Pause event at:", currentTime);
    // On pause, update the watch time with the current segment.
    updateWatchTime(currentTime, false);
    setAnalytics((prev) => ({
      ...prev,
      pauseCount: prev.pauseCount + 1,
      pauseResumeEvents: [
        ...prev.pauseResumeEvents,
        { pauseTime: currentTime, resumeTime: null },
      ],
    }));
  };

  // -------------------- Seek & Drag Handlers --------------------
  // When a seek or drag is initiated, record the starting time.
  const handleSeeking = () => {
    if (!videoEl) return;
    // Record seek start if not dragging.
    if (!isDragging && analyticsRef.current.currentPlayStart === null) {
      // If currentPlayStart is null, this means playback was paused; no update.
      return;
    }
    console.log("Seeking started at:", videoEl.currentTime);
  };

  // When seeking completes, update the watch time based on new currentTime.
  const handleSeeked = () => {
    if (!videoEl) return;
    if (jumpTriggeredRef.current) {
      jumpTriggeredRef.current = false;
      prevTimeRef.current = videoEl.currentTime;
      console.log("Seeked (jump triggered) at:", videoEl.currentTime);
      return;
    }
    const newTime = videoEl.currentTime;
    console.log("Seeked event to:", newTime);
    // Update watch time with new time (assuming video is playing).
    updateWatchTime(newTime);
    // Record seek event.
    setAnalytics((prev) => ({
      ...prev,
      seekCount: prev.seekCount + 1,
      skipEvents: [...prev.skipEvents, { from: prevTimeRef.current, to: newTime }],
    }));
    prevTimeRef.current = newTime;
  };

  // For timeline dragging:
  const handleTimelineMouseDown = () => {
    if (videoEl) {
      setIsDragging(true);
      setDragStartTime(videoEl.currentTime);
      console.log("Timeline drag started at:", videoEl.currentTime);
    }
  };

  const handleTimelineMouseUp = () => {
    if (videoEl && isDragging) {
      setIsDragging(false);
      const dragEndTime = videoEl.currentTime;
      console.log("Timeline drag ended at:", dragEndTime);
      updateWatchTime(dragEndTime);
      setAnalytics((prev) => ({
        ...prev,
        seekCount: prev.seekCount + 1,
        skipEvents: [...prev.skipEvents, { from: dragStartTime, to: dragEndTime }],
      }));
      prevTimeRef.current = dragEndTime;
      setDragStartTime(null);
    }
  };

  // -------------------- 10‑Second Jump Handlers --------------------
  const handleReplay = () => {
    if (!videoEl) return;
    const currentTime = videoEl.currentTime;
    const newTime = Math.max(0, currentTime - 10);
    jumpTriggeredRef.current = true;
    console.log(`Replay jump from ${currentTime} to ${newTime}`);
    updateWatchTime(newTime);
    setAnalytics((prev) => ({
      ...prev,
      jumpEvents: [...prev.jumpEvents, { type: "replay", from: currentTime, to: newTime }],
    }));
    videoEl.currentTime = newTime;
  };

  const handleForward = () => {
    if (!videoEl) return;
    const currentTime = videoEl.currentTime;
    const newTime = Math.min(videoDuration, currentTime + 10);
    jumpTriggeredRef.current = true;
    console.log(`Forward jump from ${currentTime} to ${newTime}`);
    updateWatchTime(newTime);
    setAnalytics((prev) => ({
      ...prev,
      jumpEvents: [...prev.jumpEvents, { type: "forward", from: currentTime, to: newTime }],
    }));
    videoEl.currentTime = newTime;
  };

  const handleTimeUpdate = () => {
    if (videoEl) {
      prevTimeRef.current = videoEl.currentTime;
    }
  };

  // -------------------- Fullscreen Handler --------------------
  const handleFullscreenChange = () => {
    const currentTime = videoEl && videoEl.currentTime ? videoEl.currentTime : playedSeconds;
    if (document.fullscreenElement) {
      console.log("Entered fullscreen at:", currentTime);
      setAnalytics((prev) => ({
        ...prev,
        fullscreenEvents: [...prev.fullscreenEvents, { entered: currentTime, exited: null }],
      }));
    } else {
      console.log("Exited fullscreen at:", currentTime);
      setAnalytics((prev) => {
        const events = prev.fullscreenEvents;
        if (events.length > 0 && events[events.length - 1].exited === null) {
          const updatedEvent = { ...events[events.length - 1], exited: currentTime };
          return { ...prev, fullscreenEvents: [...events.slice(0, -1), updatedEvent] };
        }
        return prev;
      });
    }
  };

  // -------------------- Download Handler --------------------
  const handleDownloadClick = () => {
    setAnalytics((prev) => ({ ...prev, download: true }));
    const a = document.createElement("a");
    a.href = "https://media.w3.org/2010/05/sintel/trailer_hd.mp4";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // -------------------- Speed Change Handler --------------------
  const handleSpeedChange = (newSpeed) => {
    if (!videoEl) return;
    const currentTime = videoEl.currentTime;
    console.log("Speed change at:", currentTime, "New speed:", newSpeed);
    setAnalytics((prev) => {
      let updatedSpeedEvents = [...prev.speedEvents];
      if (prev.currentSpeedEvent) {
        updatedSpeedEvents.push({ ...prev.currentSpeedEvent, endTime: currentTime });
      }
      return {
        ...prev,
        speedEvents: updatedSpeedEvents,
        currentSpeedEvent: { speed: newSpeed, startTime: currentTime, endTime: null },
      };
    });
    setPlaybackRate(newSpeed);
  };

  // -------------------- Attach Native Video Event Listeners --------------------
  useEffect(() => {
    if (!videoEl) return;
    videoEl.addEventListener("play", handlePlay);
    videoEl.addEventListener("pause", handlePause);
    videoEl.addEventListener("seeking", handleSeeking);
    videoEl.addEventListener("seeked", handleSeeked);
    videoEl.addEventListener("timeupdate", handleTimeUpdate);
    return () => {
      videoEl.removeEventListener("play", handlePlay);
      videoEl.removeEventListener("pause", handlePause);
      videoEl.removeEventListener("seeking", handleSeeking);
      videoEl.removeEventListener("seeked", handleSeeked);
      videoEl.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [videoEl, isDragging]);

  useEffect(() => {
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [videoEl, playedSeconds]);

  // Attach timeline drag listeners.
  useEffect(() => {
    const timeline = document.querySelector(".video-react-progress-control");
    if (timeline) {
      timeline.addEventListener("mousedown", handleTimelineMouseDown);
      timeline.addEventListener("mouseup", handleTimelineMouseUp);
      return () => {
        timeline.removeEventListener("mousedown", handleTimelineMouseDown);
        timeline.removeEventListener("mouseup", handleTimelineMouseUp);
      };
    }
  }, [videoEl, isDragging, dragStartTime]);

  // -------------------- Periodic Analytics Submission --------------------
  useEffect(() => {
    if (!videoEl) {
      console.log("videoEl not available; analytics interval not set.");
      return;
    }
    console.log("Starting analytics interval...");
    const interval = setInterval(async () => {
      try {
        // Before sending, update any ongoing play segment.
        const currentTime = videoEl.currentTime || playedSeconds;
        if (!videoEl.paused && analyticsRef.current.currentPlayStart !== null) {
          updateWatchTime(currentTime);
        }
        const updatedAnalytics = {
          ...analyticsRef.current,
          inTime: entryTime, // Add the static entry time
          outTime: new Date().toISOString(),
          ip: ip || "",
          location: location || "",
          userId: userId || "",
          region: region || "",
          os: os || "",
          device: device || "",
          browser: browser || "",
          videoId: window.location.pathname.split("/").pop() || "",
          sourceUrl: url,
        };

        const payload = JSON.stringify({
          ...updatedAnalytics,
          totalWatchTimeFormatted: formatTime(updatedAnalytics.totalWatchTime),
          pauseResumeEvents: updatedAnalytics.pauseResumeEvents.map((event) => ({
            pauseTime: event.pauseTime,
            pauseTimeFormatted: formatTime(event.pauseTime),
            resumeTime: event.resumeTime,
            resumeTimeFormatted: event.resumeTime !== null ? formatTime(event.resumeTime) : null,
          })),
          skipEvents: updatedAnalytics.skipEvents.map((event) => ({
            from: event.from,
            fromFormatted: formatTime(event.from),
            to: event.to,
            toFormatted: formatTime(event.to),
          })),
          jumpEvents: updatedAnalytics.jumpEvents.map((event) => ({
            type: event.type,
            from: event.from,
            fromFormatted: formatTime(event.from),
            to: event.to,
            toFormatted: formatTime(event.to),
          })),
          speedEvents: updatedAnalytics.speedEvents.map((event) => ({
            speed: event.speed,
            startTime: event.startTime,
            startTimeFormatted: formatTime(event.startTime),
            endTime: event.endTime,
            endTimeFormatted: event.endTime !== null ? formatTime(event.endTime) : null,
          })),
          fullscreenEvents: updatedAnalytics.fullscreenEvents.map((event) => ({
            entered: event.entered,
            enteredFormatted: formatTime(event.entered),
            exited: event.exited,
            exitedFormatted: event.exited !== null ? formatTime(event.exited) : null,
          })),
        });

        console.log("Sending analytics payload:", payload);
        const response = await fetch(backendUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        });
        if (!response.ok) {
          console.error("Analytics API response status:", response.status);
        } else {
          const result = await response.json();
          console.log("Periodic analytics data sent successfully:", result);
        }
      } catch (err) {
        console.error("Error sending periodic analytics data:", err);
      }
    }, 15000);

    return () => {
      console.log("Clearing analytics interval.");
      clearInterval(interval);
    };
  }, [videoEl, ip, location, userId, region, os, device, browser, url, entryTime]);

  // -------------------- Render --------------------
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        backgroundColor: "black",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "70%",
          maxWidth: "70%",
          margin: "auto",
          border: "2px solid white",
          backgroundColor: "black",
          padding: "10px",
          borderRadius: "5px",
        }}
      >
        <div style={{ position: "relative" }}>
          <Player
            ref={playerRef}
            onLoadedMetadata={() => {
              const video = playerRef.current?.video?.video;
              if (video) {
                setVideoEl(video);
                console.log("Video element set:", video);
              } else {
                console.error("Unable to get video element.");
              }
              const duration = playerRef.current.getState().player.duration;
              setVideoDuration(duration);
              console.log(`Total video duration: ${duration} seconds`);
            }}
            src={url}
            playbackRate={playbackRate}
          >
            <BigPlayButton position="center" />
            <ControlBar autoHide={false}>
              <VolumeMenuButton vertical />
              <CurrentTimeDisplay order={4.1} />
              <TimeDivider order={4.2} />
              <DurationDisplay order={4.3} />
              <PlaybackRateMenuButton rates={[0.5, 1, 1.5, 2, 2.5, 3]} order={7.1} />
            </ControlBar>
          </Player>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "rgba(0,0,0,0.5)",
              padding: "8px",
              borderRadius: "5px",
            }}
          >
            <div style={{ display: "flex", gap: "15px", alignItems: "center" }}>
              <button
                onClick={() => {
                  setIsMuted(!isMuted);
                  if (videoEl) videoEl.muted = !isMuted;
                }}
                style={{
                  color: "white",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {isMuted ? "🔇" : "🔊"}
              </button>
              <button
                onClick={() => {
                  if (document.pictureInPictureElement) {
                    document.exitPictureInPicture();
                    setIsPiP(false);
                  } else if (videoEl) {
                    videoEl.requestPictureInPicture();
                    setIsPiP(true);
                  }
                }}
                style={{
                  color: "white",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {isPiP ? "📺 Exit PiP" : "📺 PiP"}
              </button>
              <button
                onClick={() => {
                  if (!isFullscreen) {
                    if (videoEl && videoEl.requestFullscreen) {
                      videoEl.requestFullscreen();
                    }
                  } else {
                    document.exitFullscreen();
                  }
                  setIsFullscreen(!isFullscreen);
                }}
                style={{
                  color: "white",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
              <button
                onClick={handleReplay}
                style={{
                  color: "white",
                  background: "none",
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: "10px",
                  border: "none",
                }}
              >
                ⏪ 10s
              </button>
              <button
                onClick={handleForward}
                style={{
                  color: "white",
                  background: "none",
                  borderRadius: "10px",
                  cursor: "pointer",
                  padding: "4px 8px",
                  border: "none",
                }}
              >
                10s ⏩
              </button>
            </div>
            <div style={{ color: "white", fontSize: "14px" }}>
              {Math.floor(playedSeconds)}s / {Math.floor(videoDuration)}s
            </div>
            <select
              onChange={(e) => handleSpeedChange(Number(e.target.value))}
              value={playbackRate}
              style={{
                background: "black",
                color: "white",
                border: "1px solid white",
                cursor: "pointer",
              }}
            >
              <option value="0.5">0.5x</option>
              <option value="1">1x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
              <option value="2.5">2.5x</option>
              <option value="3">3x</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoWithAdvancedFeatures;
