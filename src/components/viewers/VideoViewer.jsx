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
  // Extract values from user context.
  const { ip, location, userId, region, os, device, browser } = useUser();
  console.log(ip, location, userId, region, os, device, browser, "user context data");
  console.log(window.location.pathname, "videoId from path");
  console.log(userId, "userid");

  // -------------------- User Identification API Logic --------------------
  // Use a ref to ensure the API call happens only once.
  const apiCalledRef = useRef(false);

  // Identification API call: fires once after 3 seconds if userId is valid.
  const sendIdentificationRequest = useCallback(async () => {
    if (!userId || !window.location.pathname) return;

    const documentId = window.location.pathname.split("/").pop();
    const requestData = { userId, documentId, mimeType: "video" };

    try {
      const response = await fetch("https://user-view-backend.vercel.app/api/user/identify", {
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
      }, 3000); // 3-second delay

      return () => clearTimeout(timer);
    }
  }, [userId, sendIdentificationRequest]);

  // -------------------- Video Analytics Code --------------------
  const playerRef = useRef(null);
  const [videoEl, setVideoEl] = useState(null); // HTMLVideoElement
  const [playedSeconds, setPlayedSeconds] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Extended analytics state.
  const [analytics, setAnalytics] = useState({
    totalWatchTime: 0,
    playCount: 0,
    pauseCount: 0,
    seekCount: 0,
    pauseResumeEvents: [], // Each: { pauseTime, resumeTime }
    skipEvents: [],        // For timeline drags (native seek events)
    jumpEvents: [],        // For 10-sec forward/backward jumps
    speedEvents: [],       // Completed speed events: { speed, startTime, endTime }
    currentSpeedEvent: null, // Ongoing speed event
    fullscreenEvents: [],  // Each: { entered, exited }
    download: false,
    currentPlayStart: null, // Start time of current continuous play segment
  });

  // Backend API endpoint.
  const backendUrl = "https://user-view-backend.vercel.app/api/v1/video/analytics";

  // Helper: Format seconds.
  const formatTime = (seconds) => {
    seconds = Math.floor(seconds);
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    else if (mins > 0) return `${mins}m ${secs}s`;
    else return `${secs}s`;
  };

  // Create a ref to always hold the latest analytics state.
  const analyticsRef = useRef(analytics);
  useEffect(() => {
    analyticsRef.current = analytics;
  }, [analytics]);

  // Refs for previous time and seek start.
  const prevTimeRef = useRef(0);
  const seekStartRef = useRef(null);
  // For timeline dragging.
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartTime, setDragStartTime] = useState(null);
  const [dragSeekRecorded, setDragSeekRecorded] = useState(false);
  // Flag to mark that a jump (10-sec button) was triggered.
  const jumpTriggeredRef = useRef(false);

  // Update playedSeconds every 500ms.
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

  // --------------------------------------------------
  // Playback Analytics Handlers (Play, Pause, Seek)
  // --------------------------------------------------
  const handlePlay = () => {
    const currentTime = videoEl ? videoEl.currentTime : playedSeconds;
    setAnalytics((prev) => {
      const updatedPauseEvents = [...prev.pauseResumeEvents];
      if (
        updatedPauseEvents.length > 0 &&
        updatedPauseEvents[updatedPauseEvents.length - 1].resumeTime === null
      ) {
        updatedPauseEvents[updatedPauseEvents.length - 1] = {
          ...updatedPauseEvents[updatedPauseEvents.length - 1],
          resumeTime: currentTime,
        };
      }
      return {
        ...prev,
        playCount: prev.playCount + 1,
        currentPlayStart: currentTime,
        pauseResumeEvents: updatedPauseEvents,
        currentSpeedEvent:
          prev.currentSpeedEvent ||
          { speed: playbackRate, startTime: currentTime, endTime: null },
      };
    });
  };

  const handlePause = () => {
    const currentTime = videoEl ? videoEl.currentTime : playedSeconds;
    setAnalytics((prev) => {
      let newSpeedEvents = prev.speedEvents;
      if (prev.currentSpeedEvent) {
        newSpeedEvents = [
          ...newSpeedEvents,
          { ...prev.currentSpeedEvent, endTime: currentTime },
        ];
      }
      return {
        ...prev,
        pauseCount: prev.pauseCount + 1,
        totalWatchTime:
          prev.totalWatchTime +
          (prev.currentPlayStart !== null ? currentTime - prev.currentPlayStart : 0),
        pauseResumeEvents: [
          ...prev.pauseResumeEvents,
          { pauseTime: currentTime, resumeTime: null },
        ],
        currentPlayStart: null,
        currentSpeedEvent: null,
        speedEvents: newSpeedEvents,
      };
    });
  };

  // Native seeking (for timeline drags).
  const handleSeeking = () => {
    if (!videoEl) return;
    if (!isDragging && seekStartRef.current === null) {
      seekStartRef.current = videoEl.currentTime;
    }
  };

  const handleSeeked = () => {
    if (!videoEl) return;
    if (jumpTriggeredRef.current) {
      jumpTriggeredRef.current = false;
      seekStartRef.current = null;
      prevTimeRef.current = videoEl.currentTime;
      return;
    }
    const newTime = videoEl.currentTime;
    const fromTime =
      seekStartRef.current !== null ? seekStartRef.current : prevTimeRef.current;
    if (newTime !== fromTime) {
      setAnalytics((prev) => ({
        ...prev,
        seekCount: prev.seekCount + 1,
        skipEvents: [...prev.skipEvents, { from: fromTime, to: newTime }],
      }));
    }
    seekStartRef.current = null;
    prevTimeRef.current = newTime;
    if (!videoEl.paused) {
      setAnalytics((prev) => ({ ...prev, currentPlayStart: newTime }));
    }
  };

  const handleTimeUpdate = () => {
    if (videoEl) {
      prevTimeRef.current = videoEl.currentTime;
    }
  };

  // --------------------------------------------------
  // Fullscreen Analytics
  // --------------------------------------------------
  const handleFullscreenChange = () => {
    const currentTime =
      videoEl && videoEl.currentTime ? videoEl.currentTime : playedSeconds;
    if (document.fullscreenElement) {
      setAnalytics((prev) => ({
        ...prev,
        fullscreenEvents: [
          ...prev.fullscreenEvents,
          { entered: currentTime, exited: null },
        ],
      }));
    } else {
      setAnalytics((prev) => {
        const events = prev.fullscreenEvents;
        if (events.length > 0 && events[events.length - 1].exited === null) {
          const updatedEvent = { ...events[events.length - 1], exited: currentTime };
          return {
            ...prev,
            fullscreenEvents: [...events.slice(0, -1), updatedEvent],
          };
        }
        return prev;
      });
    }
  };

  // --------------------------------------------------
  // Download Handler
  // --------------------------------------------------
  const handleDownloadClick = () => {
    setAnalytics((prev) => ({
      ...prev,
      download: true,
    }));
    const a = document.createElement("a");
    a.href = "https://media.w3.org/2010/05/sintel/trailer_hd.mp4";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // --------------------------------------------------
  // Speed Controller Analytics
  // --------------------------------------------------
  const handleSpeedChange = (newSpeed) => {
    const currentTime = videoEl ? videoEl.currentTime : playedSeconds;
    setAnalytics((prev) => {
      let updatedSpeedEvents = [...prev.speedEvents];
      let currentSpeedEvent = prev.currentSpeedEvent;
      if (currentSpeedEvent) {
        updatedSpeedEvents.push({ ...currentSpeedEvent, endTime: currentTime });
      }
      return {
        ...prev,
        speedEvents: updatedSpeedEvents,
        currentSpeedEvent: { speed: newSpeed, startTime: currentTime, endTime: null },
      };
    });
    setPlaybackRate(newSpeed);
  };

  // --------------------------------------------------
  // 10‑Second Jump Analytics (Forward/Replay)
  // --------------------------------------------------
  const handleReplay = () => {
    if (!videoEl) return;
    const currentTime = videoEl.currentTime;
    const newTime = Math.max(0, currentTime - 10);
    jumpTriggeredRef.current = true;
    setAnalytics((prev) => ({
      ...prev,
      jumpEvents: [
        ...prev.jumpEvents,
        { type: "replay", from: currentTime, to: newTime },
      ],
      currentPlayStart: newTime,
    }));
    videoEl.currentTime = newTime;
  };

  const handleForward = () => {
    if (!videoEl) return;
    const currentTime = videoEl.currentTime;
    const newTime = Math.min(videoDuration, currentTime + 10);
    jumpTriggeredRef.current = true;
    setAnalytics((prev) => ({
      ...prev,
      jumpEvents: [
        ...prev.jumpEvents,
        { type: "forward", from: currentTime, to: newTime },
      ],
      currentPlayStart: newTime,
    }));
    videoEl.currentTime = newTime;
  };

  // --------------------------------------------------
  // Attach Native Video Element Event Listeners
  // --------------------------------------------------
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
  }, [videoEl, isDragging, dragSeekRecorded]);

  useEffect(() => {
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [videoEl, playedSeconds]);

  // --------------------------------------------------
  // Timeline (Progress Bar) Drag Listeners
  // --------------------------------------------------
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
  }, [videoEl, isDragging, dragSeekRecorded, dragStartTime]);

  const handleTimelineMouseDown = () => {
    if (videoEl) {
      setIsDragging(true);
      setDragStartTime(videoEl.currentTime);
    }
  };

  const handleTimelineMouseUp = () => {
    if (videoEl && isDragging) {
      setIsDragging(false);
      const dragEndTime = videoEl.currentTime;
      setAnalytics((prev) => ({
        ...prev,
        seekCount: prev.seekCount + 1,
        skipEvents: [...prev.skipEvents, { from: dragStartTime, to: dragEndTime }],
      }));
      setDragStartTime(null);
      prevTimeRef.current = dragEndTime;
      setDragSeekRecorded(true);
    }
  };

  // --------------------------------------------------
  // Periodic Analytics Submission (Every 15 Seconds)
  // --------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      // Calculate additional watch time if video is playing.
      const currentTime = videoEl ? videoEl.currentTime : playedSeconds;
      let additionalTime = 0;
      if (analyticsRef.current.currentPlayStart !== null) {
        additionalTime = currentTime - analyticsRef.current.currentPlayStart;
      }
      let updatedAnalytics = {
        ...analyticsRef.current,
        totalWatchTime: analyticsRef.current.totalWatchTime + additionalTime,
      };

      // Include additional fields from user context and props.
      updatedAnalytics = {
        ...updatedAnalytics,
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
          resumeTimeFormatted:
            event.resumeTime !== null ? formatTime(event.resumeTime) : null,
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
          endTimeFormatted:
            event.endTime !== null ? formatTime(event.endTime) : null,
        })),
        fullscreenEvents: updatedAnalytics.fullscreenEvents.map((event) => ({
          entered: event.entered,
          enteredFormatted: formatTime(event.entered),
          exited: event.exited,
          exitedFormatted:
            event.exited !== null ? formatTime(event.exited) : null,
        })),
      });

      fetch(backendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((result) => {
          console.log("Periodic video analytics data sent successfully:", result);
        })
        .catch((error) =>
          console.error("Error sending periodic video analytics data:", error)
        );
    }, 10000);

    return () => clearInterval(interval);
  }, []);

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
