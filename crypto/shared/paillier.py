"""
shared/paillier.py
==================
Pure-Python implementation of the Paillier additive homomorphic cryptosystem.

This replaces the python-paillier (phe) library so the system runs with
only the standard library + the `cryptography` package (already installed).

Reference: Paillier, P. (1999). Public-key cryptosystems based on composite
           degree residuosity classes. EUROCRYPT 1999.

Mathematical background
------------------------
  Key generation:
    Choose large primes p, q.
    n = p * q,  λ = lcm(p-1, q-1),  g = n + 1  (simplified Paillier)
    μ = λ⁻¹  mod n  (modular inverse)
    Public key  = (n, g)
    Private key = (λ, μ)

  Encryption of plaintext m ∈ [0, n):
    Choose random r ∈ [1, n), gcd(r, n) = 1
    C = g^m · r^n  (mod n²)

  Decryption of ciphertext C:
    L(x) = (x - 1) / n
    m = L(C^λ  mod n²) · μ  mod n

  Homomorphic addition:
    Enc(a) * Enc(b) ≡ Enc(a + b)  (mod n²)
    (multiply ciphertexts to add plaintexts)

  Scalar multiplication:
    Enc(a)^k ≡ Enc(a * k)  (mod n²)
"""

import random
import math
import os


# ---------------------------------------------------------------------------
# Prime generation
# ---------------------------------------------------------------------------

def _is_prime_miller_rabin(n: int, k: int = 20) -> bool:
    """Miller-Rabin primality test."""
    if n < 2:
        return False
    if n == 2 or n == 3:
        return True
    if n % 2 == 0:
        return False

    # Write n-1 as 2^r * d
    r, d = 0, n - 1
    while d % 2 == 0:
        r += 1
        d //= 2

    for _ in range(k):
        a = random.randrange(2, n - 1)
        x = pow(a, d, n)
        if x == 1 or x == n - 1:
            continue
        for _ in range(r - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def _generate_prime(bits: int) -> int:
    """Generate a random prime of the given bit length."""
    while True:
        p = random.getrandbits(bits) | (1 << (bits - 1)) | 1  # odd, correct length
        if _is_prime_miller_rabin(p):
            return p


# ---------------------------------------------------------------------------
# Key pair
# ---------------------------------------------------------------------------

class PaillierPublicKey:
    def __init__(self, n: int):
        self.n = n
        self.n_sq = n * n
        self.g = n + 1  # simplified Paillier: g = n+1


class PaillierPrivateKey:
    def __init__(self, public_key: PaillierPublicKey, p: int, q: int):
        self.public_key = public_key
        self.p = p
        self.q = q
        lam = math.lcm(p - 1, q - 1)
        self._lambda = lam
        # μ = L(g^λ mod n²)⁻¹ mod n
        # With g = n+1: g^λ mod n² = 1 + λ*n (mod n²)
        # L(1 + λ*n) = λ
        self._mu = pow(lam, -1, public_key.n)

    def decrypt(self, ciphertext: "EncryptedNumber") -> int:
        pk = self.public_key
        c = ciphertext.ciphertext() if isinstance(ciphertext, EncryptedNumber) else int(ciphertext)
        # x = C^λ mod n²
        x = pow(c, self._lambda, pk.n_sq)
        # L(x) = (x - 1) // n
        lx = (x - 1) // pk.n
        # m = L(x) * μ mod n
        return (lx * self._mu) % pk.n


class EncryptedNumber:
    def __init__(self, public_key: PaillierPublicKey, raw_ciphertext: int, exponent: int = 0):
        self._pk = public_key
        self._ciphertext = raw_ciphertext
        self.exponent = exponent  # kept for API compatibility with phe

    def ciphertext(self) -> int:
        return self._ciphertext

    def __add__(self, other: "EncryptedNumber") -> "EncryptedNumber":
        """Homomorphic addition: Enc(a) * Enc(b) = Enc(a+b)."""
        if isinstance(other, EncryptedNumber):
            result = (self._ciphertext * other._ciphertext) % self._pk.n_sq
            return EncryptedNumber(self._pk, result)
        # Scalar plaintext addition: Enc(a) + k = Enc(a+k)
        k = int(other)
        enc_k = _raw_encrypt(self._pk, k)
        result = (self._ciphertext * enc_k) % self._pk.n_sq
        return EncryptedNumber(self._pk, result)

    def __radd__(self, other):
        return self.__add__(other)

    def __mul__(self, scalar: int) -> "EncryptedNumber":
        """Scalar multiplication: Enc(a)^k = Enc(a*k)."""
        result = pow(self._ciphertext, int(scalar), self._pk.n_sq)
        return EncryptedNumber(self._pk, result)

    def __rmul__(self, scalar: int) -> "EncryptedNumber":
        return self.__mul__(scalar)


# ---------------------------------------------------------------------------
# Core encrypt / decrypt
# ---------------------------------------------------------------------------

def _raw_encrypt(pk: PaillierPublicKey, plaintext: int) -> int:
    """Return raw ciphertext integer for a plaintext in [0, n)."""
    if not (0 <= plaintext < pk.n):
        raise ValueError(f"Plaintext {plaintext} out of range [0, {pk.n}).")
    r = random.randrange(1, pk.n)
    while math.gcd(r, pk.n) != 1:
        r = random.randrange(1, pk.n)
    # C = g^m * r^n mod n^2   (with g = n+1: g^m = 1 + m*n mod n^2)
    gm = (1 + plaintext * pk.n) % pk.n_sq
    rn = pow(r, pk.n, pk.n_sq)
    return (gm * rn) % pk.n_sq


def generate_paillier_keypair(n_length: int = 1024):
    """
    Generate a Paillier key pair.

    Parameters
    ----------
    n_length : int
        Bit length of n = p*q.  Use 1024 for prototype speed,
        2048 for production-level security.

    Returns
    -------
    (PaillierPublicKey, PaillierPrivateKey)
    """
    half = n_length // 2
    p = _generate_prime(half)
    q = _generate_prime(half)
    while q == p:
        q = _generate_prime(half)
    n = p * q
    pk = PaillierPublicKey(n)
    sk = PaillierPrivateKey(pk, p, q)
    return pk, sk


# ---------------------------------------------------------------------------
# Convenience wrapper — mirrors phe.PaillierPublicKey.encrypt()
# ---------------------------------------------------------------------------

def encrypt(public_key: PaillierPublicKey, plaintext: int) -> EncryptedNumber:
    ct = _raw_encrypt(public_key, plaintext)
    return EncryptedNumber(public_key, ct)


# Monkey-patch encrypt onto PaillierPublicKey so usage mirrors phe API
PaillierPublicKey.encrypt = lambda self, pt: encrypt(self, pt)


# ---------------------------------------------------------------------------
# Serialisation helpers (mirrors phe JSON format used in election_server.py)
# ---------------------------------------------------------------------------

def public_key_to_dict(pk: PaillierPublicKey) -> dict:
    return {"n": str(pk.n)}


def public_key_from_dict(d: dict) -> PaillierPublicKey:
    return PaillierPublicKey(n=int(d["n"]))


def private_key_to_dict(sk: PaillierPrivateKey) -> dict:
    return {"p": str(sk.p), "q": str(sk.q)}


def private_key_from_dict(d: dict, pk: PaillierPublicKey) -> PaillierPrivateKey:
    return PaillierPrivateKey(pk, p=int(d["p"]), q=int(d["q"]))


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("Generating Paillier-1024 key pair…")
    pk, sk = generate_paillier_keypair(1024)
    a, b = 7, 13
    ea = pk.encrypt(a)
    eb = pk.encrypt(b)
    ec = ea + eb
    total = sk.decrypt(ec)
    assert total == a + b, f"Expected {a+b}, got {total}"
    print(f"  Enc({a}) + Enc({b}) → decrypt → {total}  ✓")
    print("Paillier self-test PASSED.")