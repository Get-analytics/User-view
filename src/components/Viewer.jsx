import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import NotFoundPage from "./404_error/NotFoundPage";
import PDFViewer from "./viewers/PDFViewer";
import DOCXViewer from "./viewers/DOCXViewer";
import VideoViewer from "./viewers/VideoViewer";
import PPTXViewer from "./viewers/PPTXViewer";
import WebPageViewer from "./viewers/WebPageViewer";
import {  useUser } from "../context/Usercontext";


const Viewer = () => {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

   // Access context values
 
   const { ip, location, userId, region, os, device, browser} = useUser();

   // Log the context information
   console.log("Context Info:");
   console.log("IP Address:", ip);
   console.log("Location:", location);
   console.log("User ID:", userId);
   console.log("Region:", region);
   console.log("OS:", os);
   console.log("Device Type:", device);
   console.log("Browser Name:", browser);

   
  useEffect(() => {
    if (id) {
      fetch(`https://filescene.onrender.com/api/shortid/viewer/${id}`)
        .then((response) => {
          if (!response.ok) {
            throw new Error("ShortId not found");
          }
          return response.json();
        })
        .then((data) => setData(data))
        .catch((error) => setError(error.message));
    }
  }, [id]);


  console.log(data, "datatypeeeeeeeeeeeeeeeee")

  if (error) {
    return <NotFoundPage />;
  }

  if (!data) {
    return <p>Loading...</p>;
  }

  const { mimeType, originalUrl } = data;

  console.log(mimeType, originalUrl ,"hdascfafcdgfvycgfeufgwedfgwugcyTFEDYCGQeytet")

  if (!originalUrl) {
    return <NotFoundPage />;
  }

  if (!mimeType) {
    return <NotFoundPage />;
  }

  // Render appropriate viewer based on mimeType
  if (mimeType.includes("video")) {
    const type = mimeType.split("/")[0]; // This will return "video"
    return <VideoViewer url={originalUrl} mimeType={type} />;
  }
   else if (mimeType.includes("pdf")) {
    return <PDFViewer url={originalUrl} mimeType={mimeType}  />;
  } else if (mimeType === "application/msword" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return <DOCXViewer url={originalUrl} mimeType={mimeType} />;
  } else if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return <PPTXViewer url={originalUrl}  mimeType={mimeType} />;
  } else if (mimeType === "weblink") {
    return  <WebPageViewer url={originalUrl} mimeType={mimeType}  />;
  } else {
    // Default viewer for unknown or unsupported mime types
    return <WebPageViewer url={originalUrl} mimeType={mimeType}  />;
  }
};

export default Viewer;
