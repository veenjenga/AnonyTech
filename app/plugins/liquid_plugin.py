"""
app/plugins/liquid_plugin.py
─────────────────────────────
Liquid Democracy tallying plugin.
Voters may cast their vote directly OR delegate to a proxy.
Delegation is transitive (A → B → C means A's vote goes to C).

Ethics safeguard: super-delegate concentration is detected and flagged
per the PAUSE framework (Autonomy protection) — Kahng et al. (2021).
"""

import logging
from collections import defaultdict
from app.core.plugin_interface import TallyingPlugin

logger = logging.getLogger(__name__)

MAX_CHAIN_LENGTH = 20          # Terefe (2022) penalty on delegation length
CONCENTRATION_THRESHOLD = 0.30  # Flag if one delegate controls >30% of votes


class Plugin(TallyingPlugin):

    @property
    def method_name(self) -> str:
        return "liquid"

    def define_ballot_structure(self) -> dict:
        return {
            "type": "liquid_democracy",
            "description": (
                "Either cast a direct vote for a candidate, "
                "or delegate your vote to a trusted proxy voter."
            ),
            "fields": {
                "vote_type": {
                    "type": "string",
                    "enum": ["direct", "delegate"],
                    "required": True,
                },
                "choice": {
                    "type": "string",
                    "required_if": {"vote_type": "direct"},
                    "description": "Candidate name (required for direct vote).",
                },
                "delegate_to": {
                    "type": "string",
                    "required_if": {"vote_type": "delegate"},
                    "description": "Voter ID to delegate to (required for delegation).",
                },
                "voter_id": {
                    "type": "string",
                    "required": True,
                    "description": "Anonymous voter token.",
                },
            },
        }

    def validate_ballot(self, ballot: dict) -> tuple[bool, list[str]]:
        errors = []
        if "vote_type" not in ballot:
            errors.append("Missing 'vote_type' ('direct' or 'delegate').")
        elif ballot["vote_type"] == "direct":
            if not ballot.get("choice", "").strip():
                errors.append("Direct vote requires a non-empty 'choice'.")
        elif ballot["vote_type"] == "delegate":
            if not ballot.get("delegate_to", "").strip():
                errors.append("Delegation requires a non-empty 'delegate_to'.")
        else:
            errors.append(f"Unknown vote_type: {ballot['vote_type']!r}")
        if not ballot.get("voter_id", "").strip():
            errors.append("Missing 'voter_id'.")
        return (len(errors) == 0, errors)

    def count_votes(self, ballots: list[dict]) -> dict:
        direct_votes: dict[str, str] = {}    # voter_id → candidate
        delegations: dict[str, str] = {}      # voter_id → delegate_voter_id
        valid_count = 0

        for b in ballots:
            ok, _ = self.validate_ballot(b)
            if not ok:
                continue
            valid_count += 1
            vid = b["voter_id"]
            if b["vote_type"] == "direct":
                direct_votes[vid] = b["choice"].strip()
            else:
                delegations[vid] = b["delegate_to"].strip()

        # Resolve delegation chains
        final_votes: dict[str, str] = {}      # voter_id → resolved candidate
        unresolvable: list[str] = []

        all_voters = set(direct_votes) | set(delegations)
        for voter in all_voters:
            candidate, chain_len, cycle_guard = self._resolve(
                voter, direct_votes, delegations, set()
            )
            if candidate is None:
                unresolvable.append(voter)
            else:
                final_votes[voter] = candidate

        # Tally
        from collections import Counter
        tally: Counter = Counter(final_votes.values())

        # Concentration check (PAUSE / Autonomy)
        concentration_warnings = []
        if valid_count > 0:
            for candidate_or_delegate, count in tally.items():
                pct = count / valid_count
                if pct > CONCENTRATION_THRESHOLD:
                    concentration_warnings.append(
                        f"'{candidate_or_delegate}' controls {pct:.1%} of resolved votes "
                        f"({count}/{valid_count}) — exceeds {CONCENTRATION_THRESHOLD:.0%} threshold."
                    )

        winner = tally.most_common(1)[0][0] if tally else None
        return {
            "winner": winner,
            "tally": dict(tally),
            "rounds": [dict(tally)],
            "valid_ballots": valid_count,
            "unresolvable": unresolvable,
            "concentration_warnings": concentration_warnings,
        }

    def _resolve(
        self,
        voter: str,
        direct_votes: dict[str, str],
        delegations: dict[str, str],
        visited: set,
        depth: int = 0,
    ) -> tuple[str | None, int]:
        """
        Traverse delegation chain to find the terminal direct vote.
        Returns (candidate | None, chain_length).
        None means cycle detected, chain too long, or dangling delegation.
        """
        if depth > MAX_CHAIN_LENGTH:
            logger.warning("Delegation chain too long for voter %s (limit %d)", voter, MAX_CHAIN_LENGTH)
            return None, depth

        if voter in visited:
            logger.warning("Delegation cycle detected involving voter %s", voter)
            return None, depth

        if voter in direct_votes:
            return direct_votes[voter], depth

        if voter in delegations:
            delegate = delegations[voter]
            return self._resolve(delegate, direct_votes, delegations, visited | {voter}, depth + 1)

        return None, depth  # dangling delegation (delegate has no ballot)

    def describe_results(self, result: dict) -> str:
        lines = [
            "Election method: Liquid Democracy",
            f"Total valid ballots: {result['valid_ballots']}",
            f"Unresolvable delegations: {len(result.get('unresolvable', []))}",
            "",
            "Resolved vote totals:",
        ]
        for candidate, count in sorted(result["tally"].items(), key=lambda x: -x[1]):
            marker = " ← WINNER" if candidate == result["winner"] else ""
            lines.append(f"  {candidate}: {count} votes{marker}")

        if result.get("concentration_warnings"):
            lines += ["", "⚠ Autonomy Warnings (PAUSE framework):"]
            lines += [f"  {w}" for w in result["concentration_warnings"]]

        return "\n".join(lines)
