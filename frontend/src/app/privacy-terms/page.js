import Link from "next/link";

export default function PrivacyTerms() {
  return (
    <main
      style={{
        maxWidth: "900px",
        margin: "60px auto",
        padding: "40px",
        background: "#ffffff",
        borderRadius: "12px",
        boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
        lineHeight: "1.7",
        fontSize: "15px",
        color: "#374151"
      }}
    >
      <div style={{ marginBottom: "20px" }}>
        <Link
          href="/"
          style={{
            color: "#2563eb",
            textDecoration: "underline",
            fontSize: "14px"
          }}
        >
          ← Back to Search
        </Link>
      </div>

      <h1 style={{ fontSize: "28px", marginBottom: "20px" }}>
        Privacy Policy & Terms of Use
      </h1>

      <h2 style={{ fontSize: "20px", marginTop: "25px" }}>Privacy Policy</h2>

      <p>
        This website does not request or intentionally collect directly identifying
        personal information such as names, addresses, or email addresses.
      </p>

      <p>
        Limited technical information such as anonymous usage data and system logs
        may be collected to improve the accuracy and performance of the platform.
      </p>

      <h2 style={{ fontSize: "20px", marginTop: "25px" }}>Terms of Use</h2>

      <p>
        The information provided on this site is intended for informational and
        research purposes only.
      </p>

      <p>
        This tool performs automated analysis of publicly available patent data and
        does not provide legal advice or a definitive patentability determination.
      </p>

      <p>
        Users should consult qualified intellectual property professionals before
        making legal or commercial decisions based on results from this tool.
      </p>

      <h2 style={{ fontSize: "20px", marginTop: "25px" }}>
        Data Source Attribution
      </h2>

      <p>
        Patent data displayed on this website is provided by the United States
        Patent and Trademark Office (USPTO) through the PatentsView platform.
      </p>

      <p>
        Learn more about PatentsView at{" "}
        <a
          href="https://patentsview.org"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#2563eb", textDecoration: "underline" }}
        >
          https://patentsview.org
        </a>
      </p>
    </main>
  );
}