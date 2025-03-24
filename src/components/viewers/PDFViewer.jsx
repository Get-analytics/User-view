import React, { useEffect, useState, useRef, useCallback } from "react";
import { Worker, Viewer } from "@react-pdf-viewer/core";
import "@react-pdf-viewer/core/lib/styles/index.css";
import { useUser } from "../../context/Usercontext";

const MyPdfViewer = ({ url, mimeType }) => {
  const { ip, location, userId, region, os, device, browser } = useUser();
  const [pdfjs, setPdfjs] = useState(null);
  const [pdfjsWorker, setPdfjsWorker] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Refs for tracking page time, visited pages, and to prevent multiple API calls
  const timeSpentRef = useRef({});
  const pageTimerRef = useRef(null);
  const visitedPagesRef = useRef(new Set());
  const milestoneVisitedPagesRef = useRef(0);

  // Analytics states
  const [totalClicks, setTotalClicks] = useState(0);
  const [selectedTexts, setSelectedTexts] = useState([]);
  const [linkClicks, setLinkClicks] = useState([]);
  const [pageVisitCount, setPageVisitCount] = useState({});

  const fileUrl = url;

  // Initial analytics data
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
    inTime: new Date().toISOString(),
    outTime: null,
    mostVisitedPage: null,
    linkClicks: [],
    totalPages: 0,
  });

  // Store the latest analytics data in a ref
  const analyticsDataRef = useRef(analyticsData);
  useEffect(() => {
    analyticsDataRef.current = analyticsData;
  }, [analyticsData, selectedTexts, totalClicks, linkClicks]);

  // Flag to ensure the identity API is only called once
  const identityCalledRef = useRef(false);

  // Identity API call: triggered only once when data is ready.
  const sendIdentificationRequest = useCallback(async () => {
    if (!userId || !window.location.pathname || identityCalledRef.current) return;
    identityCalledRef.current = true;
    const documentId = window.location.pathname.split("/").pop();
    const requestData = { userId, documentId, mimeType: "pdf" };

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
  }, [userId, mimeType]);

  // Trigger identity API once after 3 seconds if data is ready
  useEffect(() => {
    if (userId && userId.length > 15 && !identityCalledRef.current) {
      const timer = setTimeout(() => {
        sendIdentificationRequest();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [userId, sendIdentificationRequest]);

  // Update analyticsData if context values change
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

  // Dynamically load pdfjs and its worker
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

  // Track page changes: time, visited pages, and most visited page
  const handlePageChange = useCallback(
    (e) => {
      const newPage = e.currentPage + 1;
      clearInterval(pageTimerRef.current);

      if (!timeSpentRef.current[newPage]) {
        timeSpentRef.current[newPage] = 0;
      }

      pageTimerRef.current = setInterval(() => {
        timeSpentRef.current[newPage] += 1;
        setAnalyticsData((prevData) => ({
          ...prevData,
          totalTimeSpent: prevData.totalTimeSpent + 1,
          pageTimeSpent: {
            ...prevData.pageTimeSpent,
            [newPage]: (prevData.pageTimeSpent[newPage] || 0) + 1,
          },
        }));
      }, 1000);

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
    [setAnalyticsData]
  );

  // Track text selection on the PDF
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

  // Handle link clicks inside the PDF
  const handleLinkClick = useCallback(
    (e) => {
      const linkElement = e.target.closest("a");
      if (linkElement) {
        // Prevent default behavior so that we control the click action
        e.preventDefault();
        const linkUrl = linkElement.href;
        console.log(`Link clicked on page ${currentPage}: ${linkUrl}`);
        window.open(linkUrl, "_blank");
        setLinkClicks((prevLinkClicks) => [...prevLinkClicks, { page: currentPage, clickedLink: linkUrl }]);
      }
    },
    [currentPage]
  );

  // General click handler to increment the click count
  const handleClick = useCallback(() => {
    setTotalClicks((prev) => prev + 1);
  }, []);

  // Periodically send analytics data every 15 seconds.
  useEffect(() => {
    const interval = setInterval(() => {
      const finalData = {
        ...analyticsDataRef.current,
        outTime: new Date().toISOString(),
        userId: userId,
        selectedTexts: selectedTexts,
        totalClicks: totalClicks,
        linkClicks: linkClicks,
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

    return () => clearInterval(interval);
  }, [userId, selectedTexts, totalClicks, linkClicks]);

  // Use a unified event listener strategy that differentiates mobile (touch) from desktop.
  useEffect(() => {
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

    const selectionHandler = () => {
      handleTextSelection();
    };

    // Combine click handling for general clicks and link clicks.
    const clickHandler = (e) => {
      handleClick();
      handleLinkClick(e);
    };

    if (isTouchDevice) {
      document.addEventListener("touchend", selectionHandler, { passive: true });
      document.addEventListener("touchend", clickHandler, { passive: true });
    } else {
      document.addEventListener("mouseup", selectionHandler);
      document.addEventListener("click", clickHandler);
    }
    return () => {
      if (isTouchDevice) {
        document.removeEventListener("touchend", selectionHandler);
        document.removeEventListener("touchend", clickHandler);
      } else {
        document.removeEventListener("mouseup", selectionHandler);
        document.removeEventListener("click", clickHandler);
      }
    };
  }, [handleTextSelection, handleClick, handleLinkClick]);

  if (!pdfjs || !pdfjsWorker) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ height: "100vh", position: "relative" }}>
      <h1 style={{ textAlign: "center", padding: "20px" }}>PDF Viewer</h1>
      <Worker workerUrl={pdfjsWorker}>
        <Viewer
          fileUrl={fileUrl}
          defaultScale={1.5}
          renderMode="canvas"
          onPageChange={handlePageChange}
          plugins={[]}
        />
      </Worker>
    </div>
  );
};

export default MyPdfViewer;
