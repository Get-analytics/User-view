import { useEffect, useRef, useState } from "react";
import { useUser } from "../../context/Usercontext";

// Fetch userId from localStorage and sessionStorage
const localStorageUserId = localStorage.getItem("userId");
const sessionStorageUserId = sessionStorage.getItem("userId");

const getMimeType = (mimeType) => {
  console.log(mimeType, "type of mime");
  // In this example, we simply return "weblink" if the mimeType is "weblink"
  if (mimeType === "weblink") {
    return mimeType;
  }
  return "weblink";
};

// API call if the user already exists
const callExistUserAPI = async (userId, mimeType) => {
  try {
    const cleanedMimeType = getMimeType(mimeType);
    const response = await fetch("https://filescene.onrender.com/api/test2/existUser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, mimeType: cleanedMimeType }),
    });
    if (!response.ok) throw new Error("Failed to call existUser API");
    console.log("existUser API called successfully");
  } catch (error) {
    console.error("Error calling existUser API:", error);
  }
};

// API call for a new user
const callNewUserAPI = async (userId, mimeType) => {
  try {
    const cleanedMimeType = getMimeType(mimeType);
    const response = await fetch("https://filescene.onrender.com/api/test1/newUser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, mimeType: cleanedMimeType }),
    });
    if (!response.ok) throw new Error("Failed to call newUser API");
    console.log("newUser API called successfully");
  } catch (error) {
    console.error("Error calling newUser API:", error);
  }
};

const WebPageViewer = ({ url, mimeType }) => {
  const { ip, location, userId, region, os, device, browser } = useUser();
  // Pointer heatmap tracking
  const heatmapData = useRef(new Map());
  const currentPos = useRef(null);
  const lastUpdate = useRef(Date.now());
  const gridSize = 20;

  // Track entry time
  const [inTime] = useState(new Date().toISOString());

  // Track if user data is fully available
  const [isUserDataLoaded, setIsUserDataLoaded] = useState(false);

  // Prevent multiple API calls for exist/new user
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

  // Logic to handle userId from localStorage and sessionStorage
  useEffect(() => {
    if (apiCalledRef.current) return;
    const delay = 2000; // 2-second delay
    const timer = setTimeout(() => {
      const isDataReady =
        ip &&
        location &&
        userId &&
        region &&
        os &&
        device &&
        browser &&
        !ip.includes("Detecting") &&
        !location.includes("Detecting") &&
        !userId.includes("Detecting") &&
        !region.includes("Detecting") &&
        !os.includes("Detecting") &&
        !device.includes("Detecting") &&
        !browser.includes("Detecting");

      if (
        localStorageUserId &&
        sessionStorageUserId &&
        localStorageUserId === sessionStorageUserId
      ) {
        callExistUserAPI(localStorageUserId, mimeType);
        apiCalledRef.current = true;
      } else if (!localStorageUserId && !sessionStorageUserId) {
        if (isDataReady && userId) {
          callNewUserAPI(userId, mimeType);
          apiCalledRef.current = true;
        }
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [
    localStorageUserId,
    sessionStorageUserId,
    userId,
    ip,
    location,
    region,
    os,
    device,
    browser,
    mimeType,
  ]);

  // Periodic Analytics Submission (Every 15 Seconds)
  useEffect(() => {
    if (!isUserDataLoaded) return;
    const interval = setInterval(() => {
      const exitTime = new Date();
      const totalTimeSpent = Math.floor((exitTime - new Date(inTime)) / 1000);

      // Process heatmap data, filtering out grid cells with <= 5 seconds recorded
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
        outTime: exitTime.toISOString(),
        totalTimeSpent,
        pointerHeatmap: filteredHeatmap,
      };

      fetch("https://filescene.onrender.com/api/v1/webpageinteraction/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((result) => {
          console.log("Periodic analytics data sent successfully:", result);
        })
        .catch((error) =>
          console.error("Error sending periodic analytics data:", error)
        );
    }, 15000);

    return () => clearInterval(interval);
  }, [isUserDataLoaded, ip, location, userId, region, os, device, browser, inTime, url]);

  // Handle pointer movement messages
  useEffect(() => {
    const handleMessage = (event) => {
      if (!event.data || typeof event.data.x !== "number" || typeof event.data.y !== "number") {
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
    return () => {
      window.removeEventListener("message", handleMessage);
    };
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
