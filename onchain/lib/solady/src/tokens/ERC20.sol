// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Minimal ERC20 implementation with EIP-2612 permit, mirroring Solady's interface surface.
/// @dev This is a lightweight drop-in used for testing the HotColdGame contract without pulling the
/// full Solady dependency tree.
abstract contract ERC20 {
    /*//////////////////////////////////////////////////////////////
                               METADATA
    //////////////////////////////////////////////////////////////*/

    function name() public view virtual returns (string memory);

    function symbol() public view virtual returns (string memory);

    function decimals() public view virtual returns (uint8) {
        return 18;
    }

    /*//////////////////////////////////////////////////////////////
                             ERC20 STORAGE
    //////////////////////////////////////////////////////////////*/

    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /*//////////////////////////////////////////////////////////////
                           EIP-2612 STORAGE
    //////////////////////////////////////////////////////////////*/

    mapping(address => uint256) public nonces;

    /*//////////////////////////////////////////////////////////////
                               EVENTS
    //////////////////////////////////////////////////////////////*/

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                         ERC20 CORE OPERATIONS
    //////////////////////////////////////////////////////////////*/

    function approve(address spender, uint256 amount) public virtual returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) public virtual returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "INSUFFICIENT_ALLOWANCE");
            unchecked {
                allowance[from][msg.sender] = allowed - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal virtual {
        require(to != address(0), "TRANSFER_TO_ZERO");
        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= amount, "INSUFFICIENT_BALANCE");
        unchecked {
            balanceOf[from] = fromBalance - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal virtual {
        require(to != address(0), "MINT_TO_ZERO");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /*//////////////////////////////////////////////////////////////
                           EIP-2612 PERMIT
    //////////////////////////////////////////////////////////////*/

    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 internal constant _EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return _buildDomainSeparator();
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual {
        require(block.timestamp <= deadline, "PERMIT_DEADLINE_EXPIRED");

        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _buildDomainSeparator(), structHash));

        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == owner, "INVALID_SIGNER");

        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function _buildDomainSeparator() internal view virtual returns (bytes32) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return keccak256(
            abi.encode(
                _EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(name())),
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    /// @notice Utility helper for testing to produce the exact digest a signer must sign.
    function permitDigest(
        address owner,
        address spender,
        uint256 value,
        uint256 nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", _buildDomainSeparator(), structHash));
    }
}
