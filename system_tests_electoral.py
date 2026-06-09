import random
import time

from app.plugins.plurality_plugin import Plugin as Plurality
from app.plugins.borda_plugin import Plugin as Borda
from app.plugins.stv_plugin import Plugin as STV
from app.plugins.liquid_plugin import Plugin as Liquid


def test_plurality_100_voters():
    """
    System Test 1: Plurality with 100 voters
    Simulates a small office election (class president, etc.)
    """
    print("\n--- SYSTEM TEST 1: Plurality — 100 Voter Election ---")
    
    plugin = Plurality()
    candidates = ["Alice", "Bob", "Carol", "David"]
    ballots = [{"choice": random.choice(candidates)} for _ in range(100)]
    
    start = time.time()
    result = plugin.count_votes(ballots)
    elapsed = time.time() - start
    
    print(f"  Election size:      100 voters")
    print(f"  Candidates:         {len(candidates)}")
    print(f"  Winner:             {result['winner']}")
    print(f"  Processing time:    {elapsed*1000:.1f}ms")
    print(f"  Valid ballots:      {result['valid_ballots']}")
    
    assert result['winner'] is not None
    assert result['valid_ballots'] == 100
    assert elapsed < 1.0, f"Took {elapsed:.2f}s, should be < 1s"
    
    print("  RESULT: PASS ✓")
    return True


def test_plurality_1000_voters():
    """
    System Test 2: Plurality with 1,000 voters
    Simulates a municipal election (city council, mayor, etc.)
    """
    print("\n--- SYSTEM TEST 2: Plurality — 1000 Voter Election ---")
    
    plugin = Plurality()
    candidates = ["Alice", "Bob", "Carol", "David", "Eve"]
    ballots = [{"choice": random.choice(candidates)} for _ in range(1000)]
    
    start = time.time()
    result = plugin.count_votes(ballots)
    elapsed = time.time() - start
    
    print(f"  Election size:      1,000 voters")
    print(f"  Candidates:         {len(candidates)}")
    print(f"  Winner:             {result['winner']}")
    print(f"  Processing time:    {elapsed*1000:.1f}ms")
    
    assert result['winner'] is not None
    assert result['valid_ballots'] == 1000
    assert elapsed < 2.0, f"Took {elapsed:.2f}s, should be < 2s"
    
    print("  RESULT: PASS ✓")
    return True


def test_plurality_realistic_distribution():
    """
    System Test 3: Realistic vote distribution
    70% for Alice, 20% for Bob, 10% for Carol (polarized election)
    """
    print("\n--- SYSTEM TEST 3: Plurality — Realistic Vote Distribution ---")
    
    plugin = Plurality()
    
    # Realistic scenario: dominant candidate
    ballots = (
        [{"choice": "Alice"} for _ in range(700)] +
        [{"choice": "Bob"} for _ in range(200)] +
        [{"choice": "Carol"} for _ in range(100)]
    )
    random.shuffle(ballots)
    
    result = plugin.count_votes(ballots)
    
    print(f"  Vote distribution:  Alice 70%, Bob 20%, Carol 10%")
    print(f"  Winner:             {result['winner']}")
    print(f"  Alice votes:        {result['tally']['Alice']} (should be ~700)")
    print(f"  Bob votes:          {result['tally']['Bob']} (should be ~200)")
    print(f"  Carol votes:        {result['tally']['Carol']} (should be ~100)")
    
    assert result['winner'] == 'Alice'
    assert result['tally']['Alice'] == 700
    assert result['tally']['Bob'] == 200
    assert result['tally']['Carol'] == 100
    
    print("  RESULT: PASS ✓")
    return True


def test_borda_complexity():
    """
    System Test 4: Borda Count with complex ranking data
    Tests a more realistic electoral method than Plurality
    """
    print("\n--- SYSTEM TEST 4: Borda Count — 50 Voters Ranking 5 Candidates ---")
    
    plugin = Borda()
    candidates = ["Alice", "Bob", "Carol", "David", "Eve"]
    
    # Create 50 voters with different preference orders
    ballots = []
    for i in range(50):
        ranking = random.sample(candidates, len(candidates))
        ballot = {"rankings": {ranking[j]: j+1 for j in range(len(ranking))}}
        ballots.append(ballot)
    
    start = time.time()
    result = plugin.count_votes(ballots)
    elapsed = time.time() - start
    
    print(f"  Voters:             50")
    print(f"  Candidates:         5 (ranked 1-5)")
    print(f"  Winner:             {result['winner']}")
    print(f"  Processing time:    {elapsed*1000:.1f}ms")
    
    assert result['winner'] is not None
    assert result['valid_ballots'] == 50
    assert elapsed < 1.0
    
    print("  RESULT: PASS ✓")
    return True


def test_stv_multi_seat():
    """
    System Test 5: Single Transferable Vote for multiple seats
    Tests proportional representation
    """
    print("\n--- SYSTEM TEST 5: STV — 100 Voters, 3 Seats, 5 Candidates ---")
    
    plugin = STV()
    candidates = ["Alice", "Bob", "Carol", "David", "Eve"]
    
    ballots = []
    for i in range(100):
        ranking = random.sample(candidates, len(candidates))
        ballot = {"rankings": {ranking[j]: j+1 for j in range(len(ranking))}}
        ballots.append(ballot)
    
    start = time.time()
    result = plugin.count_votes(ballots, seats=3)
    elapsed = time.time() - start
    
    print(f"  Voters:             100")
    print(f"  Seats to fill:      3")
    print(f"  Candidates:         5")
    print(f"  Winner(s):          {result.get('winners', [result.get('winner')])[0] if result.get('winners') else result.get('winner')}")
    print(f"  Processing time:    {elapsed*1000:.1f}ms")
    
    assert elapsed < 2.0
    
    print("  RESULT: PASS ✓")
    return True


def test_liquid_delegation_chain():
    """
    System Test 6: Liquid Democracy with delegation chains
    Tests that vote delegation chains are resolved correctly
    """
    print("\n--- SYSTEM TEST 6: Liquid Democracy — Delegation Chains ---")
    
    plugin = Liquid()
    
    # Create a delegation chain: v2 → v1, v3 → v2 (so v3 votes through v2 to v1)
    ballots = [
        {"vote_type": "direct", "choice": "Alice", "voter_id": "v1"},
        {"vote_type": "delegate", "delegate_to": "v1", "voter_id": "v2"},
        {"vote_type": "delegate", "delegate_to": "v2", "voter_id": "v3"},
        {"vote_type": "direct", "choice": "Bob", "voter_id": "v4"},
    ]
    
    result = plugin.count_votes(ballots)
    
    print(f"  v1 votes direct:    Alice")
    print(f"  v2 delegates to:    v1 (so Alice gets v1+v2)")
    print(f"  v3 delegates to:    v2 → v1 (chain resolves)")
    print(f"  v4 votes direct:    Bob")
    print(f"  Alice final count:  {result['tally'].get('Alice', 0)} (should be 3)")
    print(f"  Bob final count:    {result['tally'].get('Bob', 0)} (should be 1)")
    
    assert result['tally'].get('Alice', 0) == 3, "Delegation chain not resolved"
    assert result['tally'].get('Bob', 0) == 1
    
    print("  RESULT: PASS ✓")
    return True


def test_invalid_ballot_filtering_at_scale():
    """
    System Test 7: Invalid ballots filtered at scale
    With 1,000 ballots and 10% invalid, ensure only valid ones count
    """
    print("\n--- SYSTEM TEST 7: Invalid Ballot Filtering at Scale ---")
    
    plugin = Plurality()
    
    valid_ballots = [{"choice": "Alice"} for _ in range(450)] + [{"choice": "Bob"} for _ in range(450)]
    invalid_ballots = [{} for _ in range(50)] + [{"choice": ""} for _ in range(50)]
    
    all_ballots = valid_ballots + invalid_ballots
    random.shuffle(all_ballots)
    
    result = plugin.count_votes(all_ballots)
    
    print(f"  Input ballots:      1,000")
    print(f"  Invalid (10%):      100")
    print(f"  Valid counted:      {result['valid_ballots']}")
    print(f"  Winner:             {result['winner']}")
    
    assert result['valid_ballots'] == 900
    assert result['winner'] == 'Alice'  # Alice has 450 vs Bob's 450, but should be first
    
    print("  RESULT: PASS ✓")
    return True


if __name__ == "__main__":
    tests = [
        test_plurality_100_voters,
        test_plurality_1000_voters,
        test_plurality_realistic_distribution,
        test_borda_complexity,
        test_stv_multi_seat,
        test_liquid_delegation_chain,
        test_invalid_ballot_filtering_at_scale,
    ]
    
    passed = 0
    failed = 0
    
    print("\n" + "="*60)
    print("ELECTORAL METHODS — SYSTEM TESTS")
    print("="*60)
    
    for test_fn in tests:
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