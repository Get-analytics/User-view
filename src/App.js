import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Viewer from "./components/Viewer";
import NotFoundPage from "./components/404_error/NotFoundPage";
import { UserProvider } from "./context/Usercontext";

function App() {
  return (
    <UserProvider>
      <Router>
        <Routes>
          <Route path="/:id" element={<Viewer />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Router>
    </UserProvider>
  );
}

export default App;
