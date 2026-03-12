import Link from "next/link";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer
      role="contentinfo"
      style={{
        marginTop: "60px",
        padding: "25px 20px",
        borderTop: "1px solid #374151",
        fontSize: "13px",
        color: "#e5e7eb",
        textAlign: "center",
        lineHeight: "1.6",
      }}
    >
      <div>
        © {year} patentnoveltycheck.com. All rights reserved.
      </div>

      <div style={{ marginTop: "6px" }}>
        <Link
          href="/privacy-terms"
          style={{
            color: "#ffffff",
            textDecoration: "underline",
          }}
        >
          Privacy Policy & Terms of Use
        </Link>
      </div>

      <div style={{ marginTop: "8px" }}>
        Patent data sourced from the{" "}
        <a
          href="https://patentsview.org"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "#ffffff",
            textDecoration: "underline",
          }}
        >
          USPTO PatentsView API
        </a>
      </div>
    </footer>
  );
}