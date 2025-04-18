import React, { useEffect, useState, useRef, useCallback } from "react";
import { Worker, Viewer } from "@react-pdf-viewer/core";
import "@react-pdf-viewer/core/lib/styles/index.css";
import { useUser } from "../../context/Usercontext";
import { v4 as uuidv4 } from "uuid";


const MyPdfViewer = ({ url, mimeType }) => {
  console.log(mimeType, "mimetype");

  const { ip, location, userId, region, os, device, browser } = useUser();
  console.log(ip, location, userId, region, os, device, browser, "dataaaaaaa");
  console.log(window.location.pathname);

  console.log(userId, "userid");

  const [pdfjs, setPdfjs] = useState(null);
  const [pdfjsWorker, setPdfjsWorker] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Refs for tracking per-page time, timers, and analytics call status.
  const timeSpentRef = useRef({});
  const pageTimerRef = useRef(null);
  const visitedPagesRef = useRef(new Set());
  const milestoneVisitedPagesRef = useRef(0);
  const apiCalledRef = useRef(false);

  // Ref to capture when the user leaves the tab.
  const lastLeaveTimeRef = useRef(null);
  // New ref for auto-close timer when viewer remains hidden > 1 min.
  const autoCloseTimerRef = useRef(null);

  const sessionIdRef = useRef(uuidv4());

  // State variables for tracking user interactions for analytics.
  const [totalClicks, setTotalClicks] = useState(0);
  const [selectedTexts, setSelectedTexts] = useState([]);
  const [linkClicks, setLinkClicks] = useState([]);
  const [pageVisitCount, setPageVisitCount] = useState({});
  const [isMobile, setIsMobile] = useState(false); 

  const fileUrl = url;

  // Set up initial analytics data.
  const [analyticsData, setAnalyticsData] = useState({
    ip: ip || "",
    location: location || "",
    userId: userId || "",
    region: region || "",
    os: os || "",
    device: device || "",
    browser: browser || "",
    pdfId: window.location.pathname.split("/").pop() || "",
    sourceUrl: url,
    totalPagesVisited: 0,
    totalTimeSpent: 0,
    pageTimeSpent: {},
    selectedTexts: [],
    totalClicks: 0,
    inTime: new Date().toISOString(), // Initial load time.
    outTime: null,
    mostVisitedPage: null,
    linkClicks: [],
    totalPages: 0,
  });

  // A ref to always have the latest analyticsData.
  const analyticsDataRef = useRef(analyticsData);
  useEffect(() => {
    analyticsDataRef.current = analyticsData;
  }, [analyticsData, selectedTexts, totalClicks, linkClicks]);

  // Get userId from localStorage and sessionStorage.
  const localStorageUserId = localStorage.getItem("userId");
  const sessionStorageUserId = sessionStorage.getItem("userId");

  // Identification API call: fires once after 3 seconds if userId is valid.
  const sendIdentificationRequest = useCallback(async () => {
    if (!userId || !window.location.pathname) return;

    const documentId = window.location.pathname.split("/").pop();
    const requestData = { userId, documentId, mimeType: "pdf", sessionId: sessionIdRef.current };

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

  // Handle userId API calls based on localStorage and sessionStorage.
  useEffect(() => {
    if (apiCalledRef.current) return;
    const delay = 1000; // 1-second delay

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

      if (localStorageUserId && sessionStorageUserId && localStorageUserId === sessionStorageUserId) {
        apiCalledRef.current = true;
      } else if (!localStorageUserId && !sessionStorageUserId && isDataReady && userId) {
        apiCalledRef.current = true;
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [localStorageUserId, sessionStorageUserId, userId, ip, location, region, os, device, browser]);

  useEffect(() => {
    if (device && device !== "Detecting...") {
      setIsMobile(device.toLowerCase().includes("mobile"));
    }
  }, [device]);

  // Update analyticsData when context values change.
  useEffect(() => {
    setAnalyticsData((prevData) => ({
      ...prevData,
      ip: ip || "",
      location: location || "",
      userId: userId || "",
      region: region || "",
      os: os || "",
      device: device || "",
      browser: browser || "",
    }));
  }, [ip, location, userId, region, os, device, browser]);

  // Dynamically load pdfjs and its worker.
  useEffect(() => {
    const loadPdfjs = async () => {
      const pdfjsModule = await import("pdfjs-dist/build/pdf");
      const pdfjsWorkerModule = await import("pdfjs-dist/build/pdf.worker.entry");
      pdfjsModule.GlobalWorkerOptions.workerSrc = pdfjsWorkerModule;
      setPdfjs(pdfjsModule);
      setPdfjsWorker(pdfjsWorkerModule);
    };
    loadPdfjs();
  }, []);

  // Start or restart the per-page time tracking timer.
  const startPageTimer = useCallback(() => {
    clearInterval(pageTimerRef.current);
    pageTimerRef.current = setInterval(() => {
      const page = currentPage;
      timeSpentRef.current[page] = (timeSpentRef.current[page] || 0) + 1;
      setAnalyticsData((prevData) => ({
        ...prevData,
        totalTimeSpent: prevData.totalTimeSpent + 1,
        pageTimeSpent: {
          ...prevData.pageTimeSpent,
          [page]: (prevData.pageTimeSpent[page] || 0) + 1,
        },
      }));
    }, 1000);
  }, [currentPage]);

  // Handle page changes.
  const handlePageChange = useCallback(
    (e) => {
      const newPage = e.currentPage + 1; // Pages are zero-indexed.
      clearInterval(pageTimerRef.current);

      if (document.visibilityState === "visible") {
        startPageTimer();
      }
      
      visitedPagesRef.current.add(newPage);
      const visitedPagesCount = visitedPagesRef.current.size;

      if (visitedPagesCount >= milestoneVisitedPagesRef.current + 10) {
        milestoneVisitedPagesRef.current = Math.floor(visitedPagesCount / 10) * 10;
        console.log(`Visited Pages Milestone: ${milestoneVisitedPagesRef.current} pages visited.`);
      }

      setAnalyticsData((prevData) => ({
        ...prevData,
        totalPagesVisited: visitedPagesCount,
      }));

      setPageVisitCount((prevCount) => {
        const newCount = { ...prevCount, [newPage]: (prevCount[newPage] || 0) + 1 };
        let mostVisitedPage = null;
        let maxTimeSpent = 0;
        for (const [page, time] of Object.entries(timeSpentRef.current)) {
          if (time > maxTimeSpent) {
            mostVisitedPage = page;
            maxTimeSpent = time;
          }
        }
        setAnalyticsData((prevData) => ({
          ...prevData,
          mostVisitedPage: mostVisitedPage,
        }));
        return newCount;
      });

      setCurrentPage(newPage);
    },
    [startPageTimer]
  );

  // Track text selection on the PDF.
  const handleTextSelection = useCallback(() => {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      const truncatedText = selectedText.length > 300 ? selectedText.slice(0, 300) : selectedText;
      console.log(`Selected Text on page ${currentPage}: "${truncatedText}"`);

      setSelectedTexts((prevSelectedTexts) => {
        const existingText = prevSelectedTexts.find(
          (item) => item.selectedText === truncatedText && item.page === currentPage
        );
        if (existingText) {
          return prevSelectedTexts.map((item) =>
            item.selectedText === truncatedText && item.page === currentPage
              ? { ...item, count: item.count + 1 }
              : item
          );
        } else {
          return [...prevSelectedTexts, { selectedText: truncatedText, count: 1, page: currentPage }];
        }
      });
    }
  }, [currentPage]);

  // Intercept link clicks inside the PDF.
  const handleLinkClick = useCallback(
    (e) => {
      const linkElement = e.target.closest("a");
      if (linkElement) {
        e.preventDefault();
        const linkUrl = linkElement.href;
        console.log(`Link clicked on page ${currentPage}: ${linkUrl}`);
        window.open(linkUrl, "_blank");
        setLinkClicks((prevLinkClicks) => [
          ...prevLinkClicks,
          { page: currentPage, clickedLink: linkUrl },
        ]);
      }
    },
    [currentPage]
  );

  // General click handler to increment the click count.
  const handleClick = useCallback(() => {
    setTotalClicks((prev) => prev + 1);
  }, []);

  // ---------------------------------------------------------------------------
  // Updated Analytics Interval & Visibility Change Handler
  // ---------------------------------------------------------------------------
  const analyticsIntervalRef = useRef(null);
  const absenceTimesRef = useRef([]);

  const startAnalyticsInterval = useCallback(() => {
    analyticsIntervalRef.current = setInterval(() => {
      let payloadOutTime;
      const currentTime = new Date();
  
      if (lastLeaveTimeRef.current) {
        const leaveTime = new Date(lastLeaveTimeRef.current);
        const absenceDurationMs = currentTime - leaveTime;
        const absenceSeconds = Math.round(absenceDurationMs / 1000);
  
        const computedOutTime = new Date(currentTime - absenceDurationMs).toISOString();
  
        console.log("timeformat");
        console.log(
          `${currentTime.toISOString().replace("Z", "+00:00")} - ${absenceSeconds}s = ${computedOutTime.replace("Z", "+00:00")}`
        );
  
        absenceTimesRef.current.push({
          leaveTime: leaveTime.toISOString(),
          returnTime: currentTime.toISOString(),
          absenceSeconds,
          computedOutTime,
        });
  
        payloadOutTime = computedOutTime;
      } else {
        payloadOutTime = currentTime.toISOString();
      }
  
      lastLeaveTimeRef.current = null;
  
      const finalData = {
        ...analyticsDataRef.current,
        outTime: payloadOutTime,
        userId,
        sessionId: sessionIdRef.current,  // <-- ADD THIS LINE
        selectedTexts,
        totalClicks,
        linkClicks,
        absenceHistory: absenceTimesRef.current,
      };
  
      const sendAnalyticsData = async () => {
        try {
          const response = await fetch("https://user-view-backend.vercel.app/api/PdfInfo/pdfpageinfo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(finalData),
          });
          if (!response.ok) throw new Error("Network response was not ok");
          const result = await response.json();
          console.log("Periodic analytics data sent successfully:", result);
        } catch (error) {
          console.error("Error sending periodic analytics data:", error);
        }
      };
      sendAnalyticsData();
    }, 15000);
  }, [userId, selectedTexts, totalClicks, linkClicks]);
  
  useEffect(() => {
    startAnalyticsInterval();
    return () => {
      clearInterval(analyticsIntervalRef.current);
    };
  }, [startAnalyticsInterval]);

  // Listen for page visibility changes.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Record the moment the user leaves the tab.
        lastLeaveTimeRef.current = new Date().toISOString();
        clearInterval(analyticsIntervalRef.current);
        analyticsIntervalRef.current = null;
        clearInterval(pageTimerRef.current);
        pageTimerRef.current = null;

        // Start auto-close timer for 20 minute of absence.
        autoCloseTimerRef.current = setTimeout(() => {
          console.log("Absence > 1 minute. Auto-closing the viewer.");
          window.close();
        }, 600000);
      } else if (document.visibilityState === "visible") {
        // Check if the absence time was > 20 minute.
        if (lastLeaveTimeRef.current) {
          const absenceDurationMs = new Date() - new Date(lastLeaveTimeRef.current);
          if (absenceDurationMs >= 600000) {
            console.log("User was absent for more than 1 minute. Auto-closing the viewer.");
            window.close();
            return;
          }
        }

        // Clear any auto-close timer if user returns before 1 minute.
        if (autoCloseTimerRef.current) {
          clearTimeout(autoCloseTimerRef.current);
          autoCloseTimerRef.current = null;
        }
        if (!analyticsIntervalRef.current) {
          startAnalyticsInterval();
        }
        if (!pageTimerRef.current) {
          startPageTimer();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [startAnalyticsInterval, startPageTimer]);

  // Simple throttle helper to limit execution frequency (for mobile events)
  const throttle = (func, delay) => {
    let lastCall = 0;
    return (...args) => {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        func(...args);
      }
    };
  };

  useEffect(() => {
    const mobileTextSelection = throttle(handleTextSelection, 500);
    const mobileClickHandler = throttle(handleClick, 500);
    const mobileLinkClick = throttle(handleLinkClick, 500);

    const desktopTextSelection = handleTextSelection;
    const desktopClickHandler = handleClick;
    const desktopLinkClick = handleLinkClick;

    if (isMobile) {
      document.addEventListener("touchend", mobileTextSelection, { passive: true });
      document.addEventListener("touchend", mobileClickHandler, { passive: true });
      document.addEventListener("touchend", mobileLinkClick, { passive: true });
      return () => {
        document.removeEventListener("touchend", mobileTextSelection);
        document.removeEventListener("touchend", mobileClickHandler);
        document.removeEventListener("touchend", mobileLinkClick);
      };
    } else {
      document.addEventListener("mouseup", desktopTextSelection);
      document.addEventListener("click", desktopClickHandler);
      document.addEventListener("click", desktopLinkClick);
      return () => {
        document.removeEventListener("mouseup", desktopTextSelection);
        document.removeEventListener("click", desktopClickHandler);
        document.removeEventListener("click", desktopLinkClick);
      };
    }
  }, [handleTextSelection, handleClick, handleLinkClick, isMobile]);

  if (!pdfjs || !pdfjsWorker) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ height: "100vh", position: "relative" }}>
      <h1 style={{ textAlign: "center", padding: "20px" }}>PDF Viewer</h1>
      <Worker workerUrl={pdfjsWorker}>
        <Viewer
          fileUrl={fileUrl}
          defaultScale={isMobile ? 0.6 : 1.7}
          renderMode="canvas"
          onPageChange={handlePageChange}
          plugins={[]}
        />
      </Worker>
    </div>
  );
};

export default MyPdfViewer;
