import React, { useEffect, useState, useRef, useCallback } from "react";
import { useUser } from "../../context/Usercontext";

const WebPageViewer = ({ url, mimeType }) => {
  const { ip, location, userId, region, os, device, browser } = useUser();
  console.log(ip, location, userId, region, os, device, browser, "dataaaaaaa");
  console.log(window.location.pathname);
  console.log(userId, "userid");

  // Pointer heatmap tracking
  const heatmapData = useRef(new Map());
  const currentPos = useRef(null);
  const lastUpdate = useRef(Date.now());
  const gridSize = 20;

  // Track entry time
  const [inTime] = useState(new Date().toISOString());
  
  // Refs for absence tracking
  const lastLeaveTimeRef = useRef(null);
  const absenceTimesRef = useRef([]);
  // Accumulated absence (in milliseconds)
  const accumulatedAbsenceRef = useRef(0);

  // Track if user data is fully available
  const [isUserDataLoaded, setIsUserDataLoaded] = useState(false);

  // Prevent multiple API calls for identification
  const apiCalledRef = useRef(false);

  // Monitor when user data is ready
  useEffect(() => {
    if (
      ip !== "Detecting..." &&
      location !== "Detecting..." &&
      userId !== "Generating..." &&
      region !== "Detecting..." &&
      os !== "Detecting..." &&
      device !== "Detecting..." &&
      browser !== "Detecting..."
    ) {
      setIsUserDataLoaded(true);
    }
  }, [ip, location, userId, region, os, device, browser]);

  // Identification API call: fires once after 3 seconds if userId is valid.
  const sendIdentificationRequest = useCallback(async () => {
    if (!userId || !window.location.pathname) return;
    const documentId = window.location.pathname.split("/").pop();
    const requestData = { userId, documentId, mimeType: "weblink" };

    try {
      const response = await fetch("https://user-view-backend.vercel.app/api/user/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData),
      });
      if (!response.ok) throw new Error("Failed to identify user");
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

  // Handle absence immediately on visibility change.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Record the timestamp when the user leaves.
        lastLeaveTimeRef.current = new Date();
      } else if (document.visibilityState === "visible" && lastLeaveTimeRef.current) {
        const now = new Date();
        const absenceDurationMs = now - lastLeaveTimeRef.current;
        const absenceSeconds = Math.round(absenceDurationMs / 1000);

        // Add to the accumulated absence duration.
        accumulatedAbsenceRef.current += absenceDurationMs;

        absenceTimesRef.current.push({
          leaveTime: lastLeaveTimeRef.current.toISOString(),
          returnTime: now.toISOString(),
          absenceSeconds,
        });

        // Clear the last leave time.
        lastLeaveTimeRef.current = null;
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Updated Periodic Analytics Submission with corrected absence-based logic.
  useEffect(() => {
    if (!isUserDataLoaded) return;

    const analyticsInterval = setInterval(() => {
      // Only send analytics if the document is visible.
      if (document.visibilityState === "hidden") return;

      const currentTime = new Date();
      // Calculate total active time by subtracting accumulated absence from overall elapsed time.
      const elapsedTimeMs = currentTime - new Date(inTime);
      const activeTimeMs = elapsedTimeMs - accumulatedAbsenceRef.current;
      const totalTimeSpent = Math.floor(activeTimeMs / 1000);

      // Process heatmap data, filtering out low-interaction cells.
      const filteredHeatmap = Array.from(heatmapData.current.entries())
        .map(([position, time]) => ({
          position,
          timeSpent: Math.floor(time / 1000),
        }))
        .filter(({ timeSpent }) => timeSpent > 5);

      const payload = {
        ip,
        location,
        userId,
        region,
        os,
        device,
        browser,
        webId: window.location.pathname.split("/").pop() || "",
        sourceUrl: url,
        inTime,
        outTime: currentTime.toISOString(),
        totalTimeSpent,
        pointerHeatmap: filteredHeatmap,
        absenceHistory: absenceTimesRef.current,
      };

      fetch("https://user-view-backend.vercel.app/api/v1/webpageinteraction/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then((response) => {
          if (!response.ok) throw new Error("Network response was not ok");
          return response.json();
        })
        .then((result) => {
          console.log("Periodic analytics data sent successfully:", result);
        })
        .catch((error) =>
          console.error("Error sending periodic analytics data:", error)
        );
    }, 15000);

    return () => clearInterval(analyticsInterval);
  }, [isUserDataLoaded, ip, location, userId, region, os, device, browser, inTime, url]);

  // Handle pointer movement messages.
  useEffect(() => {
    const handleMessage = (event) => {
      if (
        !event.data ||
        typeof event.data.x !== "number" ||
        typeof event.data.y !== "number"
      ) {
        return;
      }
      const { x, y } = event.data;
      const gridX = Math.floor((x + gridSize / 2) / gridSize) * gridSize;
      const gridY = Math.floor(y / gridSize) * gridSize;
      const positionKey = `${gridX},${gridY}`;
      const now = Date.now();

      if (currentPos.current) {
        const elapsed = now - lastUpdate.current;
        const prevKey = `${currentPos.current.x},${currentPos.current.y}`;
        if (!isNaN(elapsed) && elapsed > 0) {
          heatmapData.current.set(prevKey, (heatmapData.current.get(prevKey) || 0) + elapsed);
        }
      }
      currentPos.current = { x: gridX, y: gridY };
      lastUpdate.current = now;
      if (!heatmapData.current.has(positionKey)) {
        heatmapData.current.set(positionKey, 0);
      }
      console.log("Pointer Data: ", { x, y, gridX, gridY });
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [url, isUserDataLoaded]);

  return (
    <iframe
      src={url}
      style={{ width: "100%", height: "100vh", border: "none" }}
      title="WebPageViewer"
    />
  );
};

export default WebPageViewer;
