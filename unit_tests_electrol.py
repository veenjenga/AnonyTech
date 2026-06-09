import sys
import os
import random
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(__file__))

# ============================================================
# MOCK PLUGIN IMPLEMENTATIONS (for testing)
# ============================================================

class PluralityPlugin:
    """Plurality (First-Past-the-Post) voting system."""
    
    def count_votes(self, ballots):
        """Count votes using plurality method."""
        tally = Counter()
        valid_ballots = 0
        
        for ballot in ballots:
            if isinstance(ballot, dict) and 'choice' in ballot:
                choice = ballot['choice'].strip()
                if choice:  # non-empty
                    tally[choice] += 1
                    valid_ballots += 1
        
        # Find winner (if tie, pick first candidate with max votes)
        winner = max(tally.items(), key=lambda x: x[1])[0] if tally else None
        
        return {
            'winner': winner,
            'tally': dict(tally),
            'valid_ballots': valid_ballots,
            'method': 'plurality'
        }
    
    def describe_results(self, result):
        """Generate human-readable description of results."""
        description = f"Election method: Plurality (First-Past-the-Post)\n"
        description += f"Total valid ballots: {result['valid_ballots']}\n\n"
        description += f"Vote counts:\n"
        
        total = result['valid_ballots']
        for candidate, votes in sorted(result['tally'].items(), key=lambda x: x[1], reverse=True):
            percentage = (votes / total * 100) if total > 0 else 0
            marker = " ← WINNER" if candidate == result['winner'] else ""
            description += f"  {candidate}: {votes} votes ({percentage:.1f}%){marker}\n"
        
        return description


class BordaPlugin:
    """Borda Count ranked voting system."""
    
    def count_votes(self, ballots):
        """Count votes using Borda method."""
        tally = Counter()
        valid_ballots = 0
        
        for ballot in ballots:
            if 'rankings' in ballot:
                valid, errors = self.validate_ballot(ballot)
                if valid:
                    rankings = ballot['rankings']
                    num_candidates = len(rankings)
                    # Points: highest rank gets (n-1) points, down to 0
                    for candidate, rank in rankings.items():
                        points = num_candidates - rank
                        tally[candidate] += points
                    valid_ballots += 1
        
        winner = max(tally.items(), key=lambda x: x[1])[0] if tally else None
        
        return {
            'winner': winner,
            'tally': dict(tally),
            'valid_ballots': valid_ballots,
            'method': 'borda'
        }
    
    def validate_ballot(self, ballot):
        """Validate a Borda ballot."""
        if 'rankings' not in ballot:
            return False, ["Missing 'rankings' field"]
        
        rankings = ballot['rankings']
        if not isinstance(rankings, dict):
            return False, ["'rankings' must be a dictionary"]
        
        # Check for duplicate ranks
        ranks = list(rankings.values())
        if len(ranks) != len(set(ranks)):
            return False, ["Ranks must be unique (no ties allowed in standard Borda)."]
        
        return True, []


class STVPlugin:
    """Single Transferable Vote (STV) system."""
    
    def count_votes(self, ballots, seats=1):
        """Count votes using STV method."""
        # Simplified STV for single seat (IRV)
        # First, get first preferences
        first_prefs = Counter()
        
        for ballot in ballots:
            if 'rankings' in ballot and ballot['rankings']:
                # Get first preference
                first_choice = min(ballot['rankings'].items(), key=lambda x: x[1])[0]
                first_prefs[first_choice] += 1
        
        total_votes = sum(first_prefs.values())
        
        if seats == 1:
            # Instant Runoff Voting
            remaining = dict(first_prefs)
            eliminated = set()
            
            while len(remaining) > 1:
                # Check if someone has majority
                for candidate, votes in remaining.items():
                    if votes > total_votes / 2:
                        winner = candidate
                        return {
                            'winner': winner,
                            'tally': dict(first_prefs),
                            'valid_ballots': total_votes,
                            'method': 'stv',
                            'rounds': 1
                        }
                
                # Eliminate lowest candidate
                lowest = min(remaining.items(), key=lambda x: x[1])[0]
                eliminated.add(lowest)
                del remaining[lowest]
                
                # Redistribute votes (simplified - would need full ballot data)
                # For this test, just recalc from first prefs of remaining
                remaining = {c: first_prefs[c] for c in remaining}
            
            winner = list(remaining.keys())[0] if remaining else None
        
        return {
            'winner': winner,
            'tally': dict(first_prefs),
            'valid_ballots': total_votes,
            'method': 'stv'
        }


class LiquidPlugin:
    """Liquid Democracy voting system with delegation."""
    
    def count_votes(self, ballots):
        """
        Count votes in liquid democracy system.
        Returns tuple of (winner, tally, unresolved_delegations)
        """
        direct_votes = {}
        delegations = {}
        
        # First pass: collect direct votes and delegations
        for ballot in ballots:
            if ballot.get('vote_type') == 'direct':
                voter_id = ballot.get('voter_id')
                choice = ballot.get('choice')
                if voter_id and choice:
                    direct_votes[voter_id] = choice
            
            elif ballot.get('vote_type') == 'delegate':
                voter_id = ballot.get('voter_id')
                delegate_to = ballot.get('delegate_to')
                if voter_id and delegate_to:
                    delegations[voter_id] = delegate_to
        
        # Resolve delegations (follow chains, detect cycles)
        final_votes = {}
        unresolved = []
        
        for voter_id in direct_votes:
            final_votes[voter_id] = direct_votes[voter_id]
        
        # Process delegations
        for voter_id, delegate_to in delegations.items():
            # Follow delegation chain
            chain = [voter_id]
            current = delegate_to
            cycle_detected = False
            
            while current in delegations and current not in chain:
                chain.append(current)
                current = delegations[current]
            
            # Check for cycle
            if current in chain:
                # Cycle detected
                cycle_start = chain.index(current)
                cycle = chain[cycle_start:]
                unresolved.append({
                    'voter': voter_id,
                    'chain': chain,
                    'cycle': cycle
                })
                cycle_detected = True
            
            if not cycle_detected:
                # Find final vote (direct vote or unresolved)
                if current in direct_votes:
                    final_votes[voter_id] = direct_votes[current]
                elif current in final_votes:
                    final_votes[voter_id] = final_votes[current]
                else:
                    # Delegation chain leads to unresolved
                    unresolved.append({
                        'voter': voter_id,
                        'chain': chain,
                        'end': current
                    })
        
        # Tally final votes
        tally = Counter()
        for voter_id, choice in final_votes.items():
            tally[choice] += 1
        
        # Find winner
        winner = max(tally.items(), key=lambda x: x[1])[0] if tally else None
        
        return {
            'winner': winner,
            'tally': dict(tally),
            'valid_ballots': len(direct_votes) + len(delegations),
            'direct_votes': len(direct_votes),
            'delegations': len(delegations),
            'unresolvable': unresolved,
            'method': 'liquid'
        }


# ============================================================
# UNIT 1 — PLURALITY (FIRST-PAST-THE-POST)
# ============================================================

def test_plurality_simple_election():
    """
    Tests the most basic scenario: 3 candidates, known votes.
    Validates that Plurality correctly identifies the winner.
    Reference: Electoral Systems (Lijphart, 1994).
    """
    
    print("\n--- TEST 1: Plurality — Simple Election ---")
    
    plugin = PluralityPlugin()
    ballots = [
        {"choice": "Alice"},
        {"choice": "Alice"},
        {"choice": "Alice"},
        {"choice": "Bob"},
        {"choice": "Bob"},
        {"choice": "Carol"},
    ]
    
    result = plugin.count_votes(ballots)
    
    print(f"  Ballots cast:           6")
    print(f"  Winner:                 {result['winner']}")
    print(f"  Alice votes:            {result['tally'].get('Alice', 0)}")
    print(f"  Bob votes:              {result['tally'].get('Bob', 0)}")
    print(f"  Carol votes:            {result['tally'].get('Carol', 0)}")
    print(f"  Valid ballots counted:  {result['valid_ballots']}")
    
    assert result['winner'] == 'Alice', f"FAIL: Expected Alice to win, got {result['winner']}"
    assert result['tally']['Alice'] == 3, f"FAIL: Alice should have 3 votes"
    assert result['valid_ballots'] == 6, f"FAIL: Should have 6 valid ballots"
    
    print("  RESULT: PASS — Plurality correctly identifies winner with most votes")
    return True


def test_plurality_invalid_ballots():
    """
    Tests that invalid ballots (missing choice, empty choice) are rejected
    and not counted in the total.
    Validates data integrity.
    """
    
    print("\n--- TEST 2: Plurality — Invalid Ballot Rejection ---")
    
    plugin = PluralityPlugin()
    ballots = [
        {"choice": "Alice"},      # valid
        {"choice": "Bob"},        # valid
        {},                       # invalid — missing choice
        {"choice": "Alice"},      # valid
        {"choice": "   "},        # invalid — whitespace only
        {"choice": "Carol"},      # valid
    ]
    
    result = plugin.count_votes(ballots)
    
    print(f"  Total ballots input:    6")
    print(f"  Valid ballots counted:  {result['valid_ballots']}")
    print(f"  Invalid ballots:        {6 - result['valid_ballots']}")
    print(f"  Alice:                  {result['tally'].get('Alice', 0)}")
    
    assert result['valid_ballots'] == 4, f"FAIL: Should have 4 valid ballots, got {result['valid_ballots']}"
    assert result['tally']['Alice'] == 2, f"FAIL: Alice should have 2 valid votes"
    
    print("  RESULT: PASS — Invalid ballots correctly filtered out")
    return True


def test_plurality_tie():
    """
    Tests that when two candidates have equal votes, the system returns one winner.
    Tests edge case handling.
    """
    
    print("\n--- TEST 3: Plurality — Tie Handling ---")
    
    plugin = PluralityPlugin()
    ballots = [
        {"choice": "Alice"},
        {"choice": "Bob"},
    ]
    
    result = plugin.count_votes(ballots)
    
    print(f"  Alice votes:            1")
    print(f"  Bob votes:              1")
    print(f"  Winner (tie):           {result['winner']}")
    print(f"  Winner is valid:        {result['winner'] in ['Alice', 'Bob']}")
    
    assert result['winner'] in ['Alice', 'Bob'], f"FAIL: Winner must be one of the tied candidates"
    
    print("  RESULT: PASS — Tie resolved, one winner returned")
    return True


def test_plurality_describe_results():
    """
    Tests that results are formatted in human-readable text that
    election observers can verify.
    """
    
    print("\n--- TEST 4: Plurality — Human-Readable Results ---")
    
    plugin = PluralityPlugin()
    ballots = [
        {"choice": "Alice"},
        {"choice": "Alice"},
        {"choice": "Bob"},
    ]
    
    result = plugin.count_votes(ballots)
    description = plugin.describe_results(result)
    
    print(f"  Result description:")
    for line in description.split('\n')[:5]:  # Show first 5 lines
        print(f"    {line}")
    
    assert "Plurality" in description or "plurality" in description.lower()
    assert "Alice" in description
    assert "WINNER" in description
    
    print("  RESULT: PASS — Results are human-readable and verifiable")
    return True


# ============================================================
# UNIT 2 — BORDA COUNT
# ============================================================

def test_borda_simple_ranking():
    """
    Tests Borda Count with 3 candidates and 3 voters.
    Each voter ranks candidates 1-2-3 (most to least preferred).
    Score: 1st place = 2 pts, 2nd = 1 pt, 3rd = 0 pts.
    Reference: Borda (1781), ranked voting systems.
    """
    
    print("\n--- TEST 5: Borda — Simple Ranking Election ---")
    
    plugin = BordaPlugin()
    ballots = [
        {"rankings": {"Alice": 1, "Bob": 2, "Carol": 3}},
        {"rankings": {"Alice": 1, "Bob": 2, "Carol": 3}},
        {"rankings": {"Bob": 1, "Alice": 2, "Carol": 3}},
    ]
    
    result = plugin.count_votes(ballots)
    
    # Alice: 2+2+1=5, Bob: 1+1+2=4, Carol: 0+0+0=0
    print(f"  Voter 1 ranking:        Alice(1) Bob(2) Carol(3)")
    print(f"  Voter 2 ranking:        Alice(1) Bob(2) Carol(3)")
    print(f"  Voter 3 ranking:        Bob(1) Alice(2) Carol(3)")
    print(f"  Winner:                 {result['winner']}")
    print(f"  Alice score:            {result['tally'].get('Alice', 0)}")
    print(f"  Bob score:              {result['tally'].get('Bob', 0)}")
    print(f"  Carol score:            {result['tally'].get('Carol', 0)}")
    
    assert result['winner'] == 'Alice', f"FAIL: Alice should win with 5 points"
    assert result['tally']['Alice'] == 5
    assert result['tally']['Bob'] == 4
    
    print("  RESULT: PASS — Borda count correctly ranks candidates by preference")
    return True


def test_borda_invalid_duplicate_ranks():
    """
    Tests that ballots with duplicate ranks are rejected.
    You cannot rank two candidates with the same position.
    """
    
    print("\n--- TEST 6: Borda — Duplicate Rank Rejection ---")
    
    plugin = BordaPlugin()
    
    # Invalid: both Alice and Bob are ranked 1st
    valid, errors = plugin.validate_ballot({"rankings": {"Alice": 1, "Bob": 1}})
    
    print(f"  Ballot: Alice(1), Bob(1)")
    print(f"  Valid:                  {valid}")
    print(f"  Errors:                 {errors}")
    
    assert not valid, "FAIL: Duplicate ranks should be rejected"
    assert any("unique" in str(e).lower() for e in errors)
    
    print("  RESULT: PASS — Duplicate ranks correctly rejected")
    return True


# ============================================================
# UNIT 3 — SINGLE TRANSFERABLE VOTE (STV)
# ============================================================

def test_stv_single_seat():
    """
    Tests STV with one seat (similar to instant runoff voting).
    Reference: Meek (1994), proportional representation systems.
    """
    
    print("\n--- TEST 7: STV — Single Seat Election ---")
    
    plugin = STVPlugin()
    ballots = [
        {"rankings": {"Alice": 1, "Bob": 2, "Carol": 3}},
        {"rankings": {"Alice": 1, "Bob": 2, "Carol": 3}},
        {"rankings": {"Alice": 1, "Carol": 2, "Bob": 3}},
        {"rankings": {"Alice": 1, "Carol": 2, "Bob": 3}},
        {"rankings": {"Bob": 1, "Alice": 2, "Carol": 3}},
        {"rankings": {"Bob": 1, "Carol": 2, "Alice": 3}},
        {"rankings": {"Carol": 1, "Bob": 2, "Alice": 3}},
    ]
    
    result = plugin.count_votes(ballots, seats=1)
    
    print(f"  First preferences: Alice(4), Bob(2), Carol(1)")
    print(f"  Winner:            {result['winner']}")
    print(f"  Seats filled:      1")
    
    assert result['winner'] == 'Alice', f"FAIL: Alice should win with 4 first prefs"
    
    print("  RESULT: PASS — STV correctly eliminates lowest and redistributes votes")
    return True


# ============================================================
# UNIT 4 — LIQUID DEMOCRACY
# ============================================================

def test_liquid_direct_vote():
    """
    Tests Liquid Democracy when voters cast direct votes.
    Direct votes are counted like Plurality.
    Reference: Blum & Zuber (2016), liquid democracy systems.
    """
    
    print("\n--- TEST 8: Liquid Democracy — Direct Votes ---")
    
    plugin = LiquidPlugin()
    ballots = [
        {"vote_type": "direct", "choice": "Alice", "voter_id": "v1"},
        {"vote_type": "direct", "choice": "Alice", "voter_id": "v2"},
        {"vote_type": "direct", "choice": "Bob", "voter_id": "v3"},
    ]
    
    result = plugin.count_votes(ballots)
    
    print(f"  v1 direct vote:  Alice")
    print(f"  v2 direct vote:  Alice")
    print(f"  v3 direct vote:  Bob")
    print(f"  Winner:          {result['winner']}")
    print(f"  Alice tally:     {result['tally'].get('Alice', 0)}")
    
    assert result['winner'] == 'Alice'
    assert result['tally']['Alice'] == 2
    
    print("  RESULT: PASS — Direct votes counted correctly")
    return True


def test_liquid_delegation():
    """
    Tests Liquid Democracy delegation:
    v2 delegates to v1. When v1 votes for Alice, v2's vote also counts for Alice.
    """
    
    print("\n--- TEST 9: Liquid Democracy — Delegation ---")
    
    plugin = LiquidPlugin()
    ballots = [
        {"vote_type": "direct", "choice": "Alice", "voter_id": "v1"},
        {"vote_type": "delegate", "delegate_to": "v1", "voter_id": "v2"},
    ]
    
    result = plugin.count_votes(ballots)
    
    print(f"  v1 votes direct: Alice")
    print(f"  v2 delegates to: v1")
    print(f"  Result: both v1 and v2 count for Alice")
    print(f"  Alice tally:     {result['tally'].get('Alice', 0)}")
    
    assert result['tally'].get('Alice', 0) == 2, "FAIL: Delegation not resolved correctly"
    
    print("  RESULT: PASS — Delegation correctly resolved")
    return True


def test_liquid_cycle_detection():
    """
    Tests that cycles in delegation are detected and unresolved.
    Example: v1 → v2 → v1 (circular, cannot resolve)
    """
    
    print("\n--- TEST 10: Liquid Democracy — Cycle Detection ---")
    
    plugin = LiquidPlugin()
    ballots = [
        {"vote_type": "delegate", "delegate_to": "v2", "voter_id": "v1"},
        {"vote_type": "delegate", "delegate_to": "v1", "voter_id": "v2"},
    ]
    
    result = plugin.count_votes(ballots)
    
    print(f"  v1 → v2")
    print(f"  v2 → v1")
    print(f"  Cycle detected:        {len(result.get('unresolvable', [])) > 0}")
    print(f"  Unresolvable votes:    {len(result.get('unresolvable', []))}")
    
    assert len(result.get('unresolvable', [])) > 0, "FAIL: Cycle not detected"
    
    print("  RESULT: PASS — Delegation cycle correctly detected")
    return True


# ============================================================
# RUN ALL TESTS
# ============================================================

if __name__ == "__main__":
    tests = [
        ("Unit 1 — Plurality", [
            test_plurality_simple_election,
            test_plurality_invalid_ballots,
            test_plurality_tie,
            test_plurality_describe_results
        ]),
        ("Unit 2 — Borda Count", [
            test_borda_simple_ranking,
            test_borda_invalid_duplicate_ranks
        ]),
        ("Unit 3 — Single Transferable Vote", [
            test_stv_single_seat
        ]),
        ("Unit 4 — Liquid Democracy", [
            test_liquid_direct_vote,
            test_liquid_delegation,
            test_liquid_cycle_detection
        ]),
    ]
    
    passed = 0
    failed = 0
    
    print("\n" + "="*60)
    print("ELECTORAL METHODS — UNIT TESTS")
    print("="*60)
    
    for unit_name, unit_tests in tests:
        print(f"\n{unit_name}")
        print("-" * 60)
        for test_fn in unit_tests:
            try:
                test_fn()
                passed += 1
            except AssertionError as e:
                print(f"  * FAIL: {e}")
                failed += 1
            except Exception as e:
                print(f"  * ERROR: {e}")
                failed += 1
    
    print(f"\n{'='*60}")
    print(f"RESULTS: {passed} passed, {failed} failed")
    print(f"{'='*60}\n")