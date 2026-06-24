export default function GovernancePage() {
  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4 mb-6">
        <p className="text-yellow-400 text-sm font-semibold mb-1">
          This module is deprecated
        </p>
        <p className="text-yellow-300/80 text-sm">
          Governance (proposals &amp; voting) has moved to{" "}
          <a
            href="https://github.com/Stellar-Re-Code/StellarSentinel"
            className="underline hover:text-yellow-200"
          >
            StellarSentinel
          </a>
          . See{" "}
          <a
            href="https://github.com/Stellar-Re-Code/StellarPay/blob/main/docs/MODULE_BOUNDARY.md"
            className="underline hover:text-yellow-200"
            target="_blank"
            rel="noopener noreferrer"
          >
            the migration plan
          </a>
          {" "}for details.
        </p>
      </div>
      <h1 className="text-3xl font-bold mb-6">Governance</h1>
      <p className="text-gray-400 mb-8">
        Create budget proposals, vote, and execute approved fund disbursements.
      </p>
      <div className="border border-dashed border-gray-600 rounded-xl p-12 text-center text-gray-500">
        Governance dashboard coming soon. See ISSUES-FRONTEND.md for
        contribution tasks.
      </div>
    </div>
  );
}
