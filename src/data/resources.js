export const cardanoResources = {
  "Libraries & Languages": [
    {
      id: 1,
      name: "Aiken",
      logo: "https://raw.githubusercontent.com/aiken-lang/branding/main/assets/logo-light.png",
      description: "A modern, functional smart contract language and toolchain for Cardano.",
      fullDescription: "Aiken is a modern, functional smart contract language and toolchain for Cardano. It is purpose-built for creating secure, reliable, and performant smart contracts, offering a clear and concise syntax, a powerful type system, and an all-in-one toolchain for testing, documenting, and deploying your projects.",
      keySolutions: ["Smart contracts", "Language", "Toolchain", "Testing"],
      website: "https://aiken-lang.org/",
      social: {
        github: "https://github.com/aiken-lang",
        discord: "https://discord.gg/ub6atE94v4",
        x: "https://x.com/aiken_eng"
      },
      docs: "https://aiken-lang.org/installation-instructions",
      category: "Libraries & Languages"
    },
    {
      id: 2,
      name: "OpShin",
      logo: "https://opshin.dev/logo.png",
      description: "A programming language for creating smart contracts on Cardano using Python.",
      fullDescription: "OpShin brings the power and familiarity of Python to the Cardano blockchain. It allows developers to write smart contracts using Python syntax, which are then compiled into Plutus Core. This lowers the barrier to entry for Python developers looking to build on Cardano.",
      keySolutions: ["Python", "Smart contracts", "Compiler", "Testing"],
      website: "https://opshin.dev/",
      social: {
        github: "https://github.com/OpShin",
        discord: "https://discord.com/invite/umR3A2g4uw",
        x: "https://x.com/OpShinDev"
      },
      docs: "https://book.opshin.dev/",
      category: "Libraries & Languages"
    },
    {
      id: 3,
      name: "Helios",
      logo: "https://helios-lang.io/img/logo.png",
      description: "A lightweight, browser-based smart contract language for the Cardano ecosystem.",
      fullDescription: "Helios is a lightweight, browser-based smart contract language that compiles to Plutus Core. It's designed for simplicity and security, enabling developers to write and test Cardano smart contracts directly in a JavaScript/TypeScript environment without needing a full development setup.",
      keySolutions: ["JavaScript", "Browser-based", "Lightweight", "Smart contracts"],
      website: "https://helios-lang.io/",
      social: {
        github: "https://github.com/Hyperion-BT/helios"
      },
      docs: "https://helios-lang.io/docs/learn/intro",
      x: "https://x.com/helios_lang",
      discord: "https://discord.gg/XTwPrvB25q",
      category: "Libraries & Languages"
    },
    {
      id: 25,
      name: "MeshJS",
      logo: "https://meshjs.dev/logo-dark.svg",
      description: "A JavaScript library for Cardano dApps, supporting transaction construction, wallet integration, and CIP-30 compliance.",
      fullDescription: "Mesh is an open-source library that provides a comprehensive set of tools for building dApps on Cardano. It simplifies wallet integration, transaction building, and smart contract interactions, offering a rich collection of UI components and utilities for a seamless developer experience.",
      keySolutions: ["Transaction building", "Wallet integration", "CIP-30 compliance", "UI components", "Frontend framework"],
      website: "https://meshjs.dev/",
      social: {
        github: "https://github.com/meshjs"
      },
      docs: "https://docs.meshjs.dev/",
      category: "Libraries & Languages"
    },
    {
      id: 26,
      name: "Lucid",
      logo: "https://lucid.spacebudz.io/logo.svg",
      description: "A JavaScript library for streamlined transaction building and wallet integration with CIP-30 support.",
      fullDescription: "Lucid is a lightweight JavaScript library that makes it easy to build Cardano transactions and interact with wallets that follow the CIP-30 standard. It's designed to be simple and intuitive, abstracting away much of the complexity of the Cardano blockchain.",
      keySolutions: ["Transaction building", "CIP-30 wallets", "NPM package", "Simple API"],
      website: "https://lucid.spacebudz.io/",
      social: {
        github: "https://github.com/spacebudz/lucid"
      },
      docs: "https://docs.lucid.spacebudz.io/",
      category: "Libraries & Languages"
    },
    {
      id: 32,
      name: "PyCardano",
      logo: "https://raw.githubusercontent.com/Emurgo/pycardano/main/docs/logo.png",
      description: "A Pythonic Cardano library for building transactions, working with Plutus scripts, and blockchain interaction.",
      fullDescription: "PyCardano is a lightweight, flexible, and easy-to-use Cardano library for Python developers. It supports transaction building, Plutus smart contract interaction, wallet management, and more, making it ideal for backend and scripting use cases on Cardano.",
      keySolutions: ["Python library", "Transaction building", "Plutus scripts", "Wallet management", "Backend integration"],
      website: "https://pycardano.readthedocs.io/",
      social: {
        github: "https://github.com/Emurgo/pycardano"
      },
      docs: "https://pycardano.readthedocs.io/",
      category: "Libraries & Languages"
    },
    {
      id: 41,
      name: "Marlowe",
      logo: "https://marlowe.iohk.io/static/favicon.svg",
      description: "Tools for creating and executing smart contracts in minutes, with options for JavaScript, Haskell, Marlowe, or Blockly.",
      fullDescription: "Marlowe provides everything needed to build and deploy secure smart contracts on Cardano quickly, supporting multiple coding options including drag-and-drop Blockly.",
      keySolutions: ["Smart contracts", "Playground", "Runtime", "TypeScript SDK"],
      website: "https://marlowe.iohk.io/",
      social: {
        github: "https://github.com/input-output-hk/marlowe"
      },
      docs: "https://docs.marlowe.iohk.io/",
      category: "Libraries & Languages"
    },
    {
      id: 51,
      name: "Cardano Serialization Lib",
      logo: "https://emurgo.io/wp-content/uploads/2020/01/emurgo-logo.svg",
      description: "Library for serialization and deserialization of Cardano data structures, with bindings for multiple languages.",
      fullDescription: "This library handles serialization and deserialization of data structures used in Cardano's Haskell implementation, supporting WASM for browser use and mobile bindings.",
      keySolutions: ["Serialization", "Deserialization", "Multi-language bindings", "WASM support"],
      website: "https://github.com/Emurgo/cardano-serialization-lib",
      social: {
        github: "https://github.com/Emurgo/cardano-serialization-lib"
      },
      category: "Libraries & Languages"
    },
    {
      id: 52,
      name: "Blaze",
      logo: "https://github.com/butaneprotocol/blaze-cardano/raw/main/logo/logo.png",
      description: "JavaScript library for building Cardano transactions and off-chain code for Aiken contracts.",
      fullDescription: "Blaze enables developers to create Cardano transactions and off-chain code for Aiken smart contracts in JavaScript, supporting multiple providers like Maestro and Blockfrost.",
      keySolutions: ["Transaction building", "Off-chain code", "Aiken integration", "Multi-provider support"],
      website: "https://blaze.butane.dev",
      social: {
        github: "https://github.com/butaneprotocol/blaze-cardano"
      },
      docs: "https://docs.blaze.butane.dev/",
      category: "Libraries & Languages"
    },
    {
      id: 54,
      name: "CardanoSharp",
      logo: "https://cardanosharp.com/logo.svg",
      description: ".NET library for Cardano blockchain development with comprehensive transaction building and wallet integration.",
      fullDescription: "CardanoSharp is a comprehensive .NET library for Cardano blockchain development. It provides tools for transaction building, wallet integration, smart contract interaction, and other Cardano-specific functionality, making it easy for .NET developers to build on Cardano.",
      keySolutions: [".NET library", "Transaction building", "Wallet integration", "Smart contracts", "C# development"],
      website: "https://cardanosharp.com/",
      social: {
        github: "https://github.com/CardanoSharp"
      },
      docs: "https://cardanosharp.com/",
      category: "Libraries & Languages"
    },
    {
      id: 55,
      name: "Cardano CLI",
      logo: "https://github.com/IntersectMBO/cardano-cli/raw/main/logo.png",
      description: "Command-line interface for interacting with the Cardano blockchain, providing direct node access and transaction management.",
      fullDescription: "The Cardano CLI is a command-line interface tool for interacting with the Cardano blockchain. It provides direct access to node functionality, transaction building, wallet management, and other core Cardano operations for advanced users and developers.",
      keySolutions: ["CLI tool", "Node interaction", "Transaction management", "Wallet operations", "Direct blockchain access"],
      website: "https://github.com/IntersectMBO/cardano-cli",
      social: {
        github: "https://github.com/IntersectMBO/cardano-cli"
      },
      docs: "https://github.com/IntersectMBO/cardano-cli#overview-of-the-cardano-cli-repository",
      category: "Libraries & Languages"
    },
    {
      id: 56,
      name: "Kupo",
      logo: "https://github.com/CardanoSolutions/kupo/raw/main/logo.png",
      description: "Lightweight indexer for Cardano blockchain data, providing efficient UTxO tracking and filtering capabilities.",
      fullDescription: "Kupo is a lightweight indexer for the Cardano blockchain that provides efficient UTxO tracking and filtering. It's designed to be fast, reliable, and easy to deploy, making it ideal for applications that need to track specific transactions or addresses.",
      keySolutions: ["UTxO tracking", "Lightweight indexer", "Fast filtering", "Easy deployment", "Blockchain indexing"],
      website: "https://github.com/CardanoSolutions/kupo",
      social: {
        github: "https://github.com/CardanoSolutions/kupo"
      },
      docs: "https://github.com/CardanoSolutions/kupo#readme",
      category: "Libraries & Languages"
    },
    {
      id: 57,
      name: "Cardano Delegation",
      logo: "https://www.npmjs.com/package/@dotare/cardano-delegation",
      description: "NPM package for Cardano delegation operations, simplifying stake pool interaction and delegation management.",
      fullDescription: "Cardano Delegation is an NPM package that provides tools for managing Cardano delegation operations. It simplifies stake pool interaction, delegation management, and provides utilities for building delegation-related applications.",
      keySolutions: ["Delegation management", "Stake pool interaction", "NPM package", "JavaScript utilities"],
      website: "https://www.npmjs.com/package/@dotare/cardano-delegation",
      social: {
        github: "https://github.com/dotare/cardano-delegation"
      },
      docs: "https://www.npmjs.com/package/@dotare/cardano-delegation",
      category: "Libraries & Languages"
    },
    {
      id: 60,
      name: "NMKR Godot Plugin",
      logo: "https://pbs.twimg.com/profile_images/1819445313037287424/EP8_eRgr_400x400.png",
      description: "A Godot plugin for accessing the NMKR Studio API, enabling NFT and blockchain integration in games.",
      fullDescription: "The NMKR SDK for Godot is a plugin that addresses the need for seamless integration of NFTs and other blockchain capabilities in the gaming industry, particularly targeting indie game developers using Godot. It facilitates easier Web3 adoption and NFT technology implementation for game developers adopting different revenue models.",
      keySolutions: ["Godot plugin", "NFT integration", "Game development", "Blockchain integration", "NMKR API"],
      website: "https://github.com/Odiobill/NmkrGodot",
      social: {
        github: "https://github.com/Odiobill/NmkrGodot",
        x: "https://x.com/godotengine" 
      },
      docs: "https://github.com/Odiobill/NmkrGodot#readme",
      category: "Minting and NFTs"
    },
    {
      id: 61,
      name: "NMKR Unity SDK",
      logo: "https://pbs.twimg.com/profile_images/1484652032635981828/UbGOIUjC_400x400.jpg",
      description: "Unity SDK for NMKR Studio API integration, enabling NFT and blockchain capabilities in Unity games.",
      fullDescription: "The NMKR Studio Unity SDK provides Unity developers with tools to integrate NMKR Studio's NFT and blockchain capabilities into their games. It enables seamless NFT minting, management, and blockchain interactions within Unity game projects.",
      keySolutions: ["Unity SDK", "NFT integration", "Game development", "Blockchain integration", "NMKR API"],
      website: "https://www.futurefest.io/",
      social: {
        github: "https://github.com/FutureFest/NMKR-Studio-Unity-SDK",
        x: "https://x.com/futurefestxr"
      },
      docs: "https://github.com/FutureFest/NMKR-Studio-Unity-SDK#readme",
      category: "Minting and NFTs"
    },
    {
      id: "[next available id]",
      name: "Kuber",
      logo: "https://dquadrant.com/wp-content/uploads/2024/07/Dquadrant-Small-logo-white-orange.webp",
      description: "Kuber transaction library/api",
      fullDescription: "Javascript and Plutus/Haskell library for simple, CIP-1694 and Hydra transactions (currently under development)",
      keySolutions: [ "Blockchain integration", "Wallet integration", "Network integration", "Hydra integration", "Transaction management" ],
      website: "https://dquadrant.com",
      social: {
        github: "https://github.com/dQuadrant/kuber"
     },
     docs: "https://github.com/dQuadrant/kuber/#readme", 
     category: "Libraries & Languages"
    }
  ],
  "Infrastructure & APIs": [
    {
      id: 4,
      name: "Koios",
      logo: "https://koios.rest/img/koios-logo-c.svg",
      description: "A decentralized and elastic RESTful API for querying the Cardano blockchain.",
      fullDescription: "Koios provides a decentralized and elastic set of RESTful APIs for querying the Cardano blockchain. It offers a free, public, and horizontally-scaled solution, ensuring high availability and performance for developers needing reliable on-chain data.",
      keySolutions: ["REST API", "Querying", "Decentralized", "Scalable"],
      website: "https://koios.rest/",
      social: {
        github: "https://github.com/cardano-community/koios-artifacts"
      },
      docs: "https://koios.rest/",
      category: "Infrastructure & APIs"
    },
    {
      id: 6,
      name: "Dandelion",
      logo: "https://gimbalabs.com/logo.svg",
      description: "A set of APIs for interacting with the Cardano blockchain, focused on ease of use.",
      fullDescription: "Dandelion, from Gimbalabs, is a set of developer-friendly APIs for interacting with the Cardano blockchain. It offers both REST and GraphQL endpoints, along with real-time updates, making it easy to integrate Cardano data into any application.",
      keySolutions: ["REST API", "GraphQL", "Real-time updates", "Developer-friendly"],
      website: "https://gimbalabs.com/dandelionapis",
      social: {
        github: "https://github.com/gimbalabs"
      },
      docs: "https://gimbalabs.com/dandelionapis",
      category: "Infrastructure & APIs"
    },
    {
      id: 27,
      name: "Blockfrost API",
      logo: "https://blockfrost.io/images/logo.svg",
      description: "Access Cardano blockchain data via REST and WebSocket APIs with free tier and multi-language SDKs.",
      fullDescription: "Blockfrost offers instant and scalable access to the Cardano blockchain through a suite of REST and WebSocket APIs. It provides a free tier, multi-language SDKs, and a straightforward interface, allowing developers to start building without running their own node.",
      keySolutions: ["Blockchain data", "REST API", "WebSocket", "Multi-language SDKs"],
      website: "https://blockfrost.io/",
      social: {
        github: "https://github.com/blockfrost"
      },
      docs: "https://docs.blockfrost.io/",
      category: "Infrastructure & APIs"
    },
    {
      id: 39,
      name: "Maestro",
      logo: "https://www.gomaestro.org/logo.svg",
      description: "A complete Web3 stack for UTxO chains like Cardano, providing blockchain indexer, transaction manager, and more.",
      fullDescription: "Maestro offers a suite of APIs and tools for building dApps on Cardano, including blockchain data access, transaction submission, and managed smart contracts.",
      keySolutions: ["API", "Indexer", "Transaction Manager", "Smart Contracts"],
      website: "https://www.gomaestro.org/",
      social: {
        github: "https://github.com/maestro-org"
      },
      category: "Infrastructure & APIs"
    },
    {
      id: 48,
      name: "Cardano GraphQL API",
      logo: "https://input-output-hk.github.io/cardano-graphql/logo.png",
      description: "GraphQL interface for querying Cardano blockchain data, allowing complex queries in a single request.",
      fullDescription: "Provides a GraphQL API for accessing Cardano blockchain data, enabling efficient and flexible querying of transactions, blocks, and other on-chain information.",
      keySolutions: ["GraphQL API", "Blockchain querying", "Data access", "Efficient queries"],
      website: "https://github.com/input-output-hk/cardano-graphql",
      social: {
        github: "https://github.com/input-output-hk/cardano-graphql"
      },
      category: "Infrastructure & APIs"
    },
    {
      id: 50,
      name: "Carp",
      logo: "https://avatars.githubusercontent.com/u/72582878?s=200&v=4",
      description: "Postgres API for Cardano data by dcSpark, providing efficient access to blockchain information.",
      fullDescription: "Carp offers an OpenAPI interface for querying Cardano data stored in a PostgreSQL database, facilitating easy integration and data retrieval for developers.",
      keySolutions: ["Postgres API", "Blockchain data access", "Query layer", "dcSpark"],
      website: "https://dcspark.github.io/carp/openapi/",
      social: {
        github: "https://github.com/dcSpark/carp"
      },
      category: "Infrastructure & APIs"
    }
  ],
  "Minting and NFTs": [
    {
      id: 31,
      name: "NMKR API",
      logo: "https://cdn.prod.website-files.com/627424a55a80c8659c58943a/66a3dec08c724972d211ca38_Logo.svg",
      description: "Mint, manage and sell NFTs or digital assets with NMKR Studio's powerful API supporting airdropping and custom metadata.",
      fullDescription: "NMKR Studio provides a powerful API for minting, managing, and selling NFTs and other digital assets on Cardano. It supports features like airdropping, custom metadata, and a built-in payment gateway to simplify the entire NFT lifecycle.",
      keySolutions: ["NFT minting", "Metadata management", "Payment gateway", "Tokenization", "Airdropping"],
      website: "https://nmkr.io/",
      social: {
        github: "https://github.com/nftmakerio",
        docs: "https://docs.nmkr.io/nmkr-studio-api/get-started-with-the-api",
        api: "https://studio-api.nmkr.io/swagger/index.html",
      },
      category: "Minting and NFTs"
    },
    {
      id: 58,
      name: "NFTcdn",
      logo: "https://nftcdn.io/logo.svg",
      description: "Content delivery network for NFT metadata and assets, providing fast and reliable access to NFT data.",
      fullDescription: "NFTcdn is a specialized content delivery network for NFT metadata and assets on Cardano. It provides fast, reliable, and decentralized access to NFT data, ensuring that NFT content is always available and accessible.",
      keySolutions: ["Content delivery", "NFT metadata", "Asset hosting", "Decentralized CDN"],
      website: "https://nftcdn.io/",
      social: {
        github: "https://github.com/nftcdn"
      },
      category: "Minting and NFTs"
    }
  ],
  "Security & Auditing": [
    {
      id: 33,
      name: "Cardano Security Best Practices",
      logo: "https://cardano.org/favicon.ico",
      description: "Official security guidelines and best practices for Cardano development.",
      fullDescription: "Comprehensive security guidelines from the Cardano Foundation covering smart contract security, wallet security, and development best practices to ensure secure dApp development.",
      keySolutions: ["Security guidelines", "Best practices", "Smart contract security", "Wallet security"],
      website: "https://docs.cardano.org/cardano-testnet/security/",
      social: {},
      category: "Security & Auditing"
    },
    {
      id: "[next available id]",
      name: "Autonomous Agent Testing",
      logo: "https://dquadrant.com/wp-content/uploads/2024/07/Dquadrant-Small-logo-white-orange.webp",
      description: "Solution to test CIP-1694 at scale to catch issues early",
      fullDescription: "Agent based solution for testing Cardano governance",
      keySolutions: [ "Blockchain integration", "CIP-1694 integration", "Agents" ],
      website: "https://agents.cardanoapi.io/",
      social: {
        github: "https://github.com/cardanoapi/autonomous-agents"
      },
      docs: "https://github.com/cardanoapi/autonomous-agents/#readme", 
      category: "Security & Auditing"
    }
  ],
  "Analytics & Data": [
    {
      id: 19,
      name: "Cardanoscan Explorer",
      logo: "https://cardanoscan.io/logo.svg",
      description: "Block explorer for Cardano displaying transactions, addresses, stake pools, and token metadata.",
      fullDescription: "Cardanoscan is a comprehensive block explorer for the Cardano blockchain. It allows users to view transactions, explore addresses, monitor stake pools, and inspect token metadata in detail.",
      keySolutions: ["Transaction tracking", "Address lookup", "Pool monitoring", "Token metadata"],
      website: "https://cardanoscan.io/",
      social: {},
      category: "Analytics & Data"
    },
    {
      id: 11,
      name: "Xerberus API",
      logo: "https://www.xerberus.io/logo.svg",
      description: "Risk rating protocol offering real-time, objective analysis of Cardano assets via APIs.",
      fullDescription: "Xerberus is a risk rating protocol that offers real-time, objective analysis of Cardano assets through a simple API. It provides data-driven scores and market insights to help users make informed decisions about tokens and NFTs.",
      keySolutions: ["Risk analysis", "Asset ratings", "Market insights", "Data-driven scores"],
      website: "https://www.xerberus.io/",
      social: {},
      category: "Analytics & Data"
    },
    {
      id: 49,
      name: "Cardano DB Sync",
      logo: "https://iohk.io/favicons/favicon-32x32.png",
      description: "Component that follows the Cardano chain and stores blocks and transactions in PostgreSQL for efficient querying.",
      fullDescription: "Cardano DB Sync synchronizes Cardano blockchain data into a PostgreSQL database, enabling efficient querying and analysis of historical blockchain data.",
      keySolutions: ["Blockchain sync", "PostgreSQL database", "Data analysis", "Query optimization"],
      website: "https://github.com/input-output-hk/cardano-db-sync",
      social: {
        github: "https://github.com/input-output-hk/cardano-db-sync"
      },
      category: "Analytics & Data"
    },
    {
      id: "[next available id]",
      name: "Mempool Explorer",
      logo: "https://dquadrant.com/wp-content/uploads/2024/07/Dquadrant-Small-logo-white-orange.webp",
      description: "Solution to track what's happening in the Mempool of Cardano node",
      fullDescription: "Web-based development environment similar like Remix to build, test and deploy smart contracts",
      keySolutions: [ "Blockchain integration", "Mempool integration", "Transaction insights" ],
      website: "https://mempool.cardanoapi.io/",
      social: {
        github: "https://github.com/cardanoapi/mempool-explorer"
      },
      docs: "https://github.com/cardanoapi/mempool-explorer/#readme", 
      category: "Analytics & Data"
    }
  ],
  "Education & Documentation": [
    {
      id: 34,
      name: "Cardano Developer Portal",
      logo: "https://cardano.org/favicon.ico",
      description: "Official Cardano developer documentation, tutorials, and learning resources.",
      fullDescription: "The official Cardano developer portal provides comprehensive documentation, tutorials, and learning resources for developers building on Cardano. Includes guides for smart contracts, dApp development, and best practices.",
      keySolutions: ["Documentation", "Tutorials", "Learning resources", "Best practices"],
      website: "https://developers.cardano.org/",
      social: {},
      category: "Education & Documentation"
    },
    {
      id: 35,
      name: "Plutus Pioneer Program",
      logo: "https://github.com/input-output-hk/plutus-pioneer-program/raw/main/plutus-pioneer-program.svg",
      description: "Official training course for Plutus smart contract development on Cardano.",
      fullDescription: "The Plutus Pioneer Program is an official training course provided by IOG Education Team to recruit and train software developers in Plutus, the native smart contract language for the Cardano ecosystem. Includes comprehensive lectures and hands-on exercises.",
      keySolutions: ["Plutus training", "Smart contracts", "Hands-on exercises", "Official course"],
      website: "https://github.com/input-output-hk/plutus-pioneer-program",
      social: {
        github: "https://github.com/input-output-hk/plutus-pioneer-program"
      },
      category: "Education & Documentation"
    },
    {
      id: 36,
      name: "Cardano CIPs",
      logo: "https://cardano.org/favicon.ico",
      description: "Cardano Improvement Proposals - official standards and specifications for Cardano.",
      fullDescription: "Cardano Improvement Proposals (CIPs) are the official standards and specifications for the Cardano ecosystem. This repository contains all approved and proposed improvements to the Cardano protocol, wallet standards, and ecosystem guidelines.",
      keySolutions: ["Standards", "Specifications", "Protocol improvements", "Wallet standards"],
      website: "https://cips.cardano.org/",
      social: {
        github: "https://github.com/cardano-foundation/CIPs"
      },
      category: "Education & Documentation"
    },
    {
      id: 37,
      name: "OpShin Pioneer Program",
      logo: "https://github.com/OpShin/opshin-pioneer-program/raw/main/opshin-pioneer-program.png",
      description: "Python-based implementation of the Plutus Pioneer Program for Cardano development.",
      fullDescription: "The OpShin Pioneer Program is a Python implementation of the Plutus Pioneer Program lectures, providing an alternative approach to learning Cardano smart contract development using Python syntax and the OpShin framework.",
      keySolutions: ["Python", "Smart contracts", "Alternative learning", "OpShin framework"],
      website: "https://github.com/OpShin/opshin-pioneer-program",
      social: {
        github: "https://github.com/OpShin/opshin-pioneer-program"
      },
      category: "Education & Documentation"
    },
    {
      id: 38,
      name: "Cardano Foundation Docs",
      logo: "https://cardano.org/favicon.ico",
      description: "Comprehensive documentation from the Cardano Foundation covering all aspects of Cardano.",
      fullDescription: "The Cardano Foundation provides comprehensive documentation covering all aspects of the Cardano blockchain, including technical specifications, governance, security guidelines, and best practices for developers and users.",
      keySolutions: ["Technical specs", "Governance", "Security guidelines", "Best practices"],
      website: "https://docs.cardano.org/",
      social: {},
      category: "Education & Documentation"
    }
  ],
  "Wallets & User Tools": [
    {
      id: 9,
      name: "Vespr Wallet",
      logo: "https://vespr.xyz/logo.svg", // Assuming logo URL; update if needed
      description: "A non-custodial mobile light wallet for Cardano with intuitive UI and dApp support.",
      fullDescription: "VESPR is a non-custodial mobile light wallet for the Cardano network that prioritizes the security and safety of your digital assets without compromising on presentation. It offers a highly intuitive UI for all users, lightning-fast transactions, NFT support, and dApp connectivity.",
      keySolutions: ["Mobile wallet", "Non-custodial", "dApp connector", "NFT support", "User-friendly"],
      website: "https://vespr.xyz",
      social: {
        x: "https://x.com/vesprwallet" // Based on search; adjust if exact
      },
      category: "Wallets & User Tools"
    },
    {
      id: 28,
      name: "Typhon Wallet",
      logo: "https://typhonwallet.io/typhon-logo-white.svg",
      description: "Fast web and browser extension wallet with dApp connectors, NFT galleries, and multi-recipient transactions.",
      fullDescription: "Typhon is a fast and feature-rich web and browser extension wallet for Cardano. It offers advanced dApp connectivity, NFT galleries, multi-recipient transactions, and seamless integration with hardware wallets for enhanced security.",
      keySolutions: ["dApp connectivity", "NFT galleries", "Hardware wallet support", "Catalyst voting"],
      website: "https://typhonwallet.io/",
      social: {
        github: "https://github.com/typhon-wallet"
      },
      category: "Wallets & User Tools"
    },
    {
      id: 29,
      name: "Lace Wallet",
      logo: "https://www.lace.io/Lace-logo-horizontal-white-solid.svg",
      description: "Cardano's official light wallet by IOG with modern UI for managing ADA, NFTs, and native tokens.",
      fullDescription: "Lace is the official light wallet platform from Input Output Global (IOG), the team behind Cardano. It features a modern, intuitive UI for managing ADA, NFTs, and native tokens, along with seamless dApp connectivity and in-app staking.",
      keySolutions: ["Official wallet", "Modern UI", "dApp connectivity", "In-app staking"],
      website: "https://www.lace.io/",
      social: {
        github: "https://github.com/input-output-hk/lace"
      },
      category: "Wallets & User Tools"
    },
    {
      id: 30,
      name: "Eternl Wallet",
      logo: "https://eternl.io/images/logo-dark.svg",
      description: "Browser-based light wallet with robust dApp integration, NFT management, and staking features.",
      fullDescription: "Eternl is a browser-based light wallet packed with advanced features for Cardano power users. It offers robust dApp integration, comprehensive NFT management, CIP-30 support, and staking features, making it a versatile tool for the community.",
      keySolutions: ["dApp integration", "NFT management", "CIP-30 support", "Hardware wallets"],
      website: "https://eternl.io/",
      social: {
        github: "https://github.com/eternl-io"
      },
      category: "Wallets & User Tools"
    },
    {
      id: 53, 
      name: "Begin Wallet",// Assumed logo URL based on site; update if needed
      description: "All-in-one self-custodial wallet for Cardano and Bitcoin with staking, lending, and dApp features.",
      fullDescription: "Begin Wallet is a decentralized, open-source wallet supporting Cardano and Bitcoin. It offers self-custody, staking ADA, lending via Liqwid, governance participation, dApp exploration with ratings, and integrations for travel and entertainment.",
      keySolutions: ["Self-custodial", "Cardano & Bitcoin support", "Staking & Delegation", "DeFi Lending", "Governance Voting", "dApp Explorer"],
      website: "https://begin.is/",
      social: {
        x: "https://x.com/BeginWallet",
        github: "https://github.com/BeginWallet"
      },
      category: "Wallets & User Tools"
    },
    {
      id: 62,
      name: "Tokeo",
      logo: "https://tokeo.io/wp-content/uploads/2024/11/tokeo-logo-wide-white.png.webp",
      description: "Multichain smart wallet for Bitcoin and Cardano with live prices, swaps, on/off-ramping, and virtual card features.",
      fullDescription: "Tokeo is a feature-rich multichain smart wallet that supports Bitcoin and Cardano. It offers live prices, swaps, on/off-ramping, order tracking, invoices, gamification, and an upcoming virtual card system powered by Mastercard. The wallet is self-custodial, giving users full control over their assets.",
      keySolutions: ["Multichain wallet", "Bitcoin & Cardano", "Live prices", "Swaps", "On/off-ramping", "Virtual card", "Self-custodial"],
      website: "https://tokeo.io/",
      social: {
        x: "https://x.com/tokeo_io"
      },
      category: "Wallets & User Tools"
    },
    {
      id: "[next available id]",
      name: "Cardano Test Wallet",
      logo: "https://dquadrant.com/wp-content/uploads/2024/07/Dquadrant-Small-logo-white-orange.webp",
      description: "A test wallet integrated with Playwright",
      fullDescription: "A test wallet for automation of end-to-end testing",
      keySolutions: [ "Blockchain integration", "Wallet integration", "Playwright integration" ],
      website: "https://dquadrant.com/",
      social: {
      github: "https://github.com/cardanoapi/cardano-test-wallet"
      },
      docs: "https://github.com/cardanoapi/cardeno-test-wallet/#readme", 
      category: "Wallets & User Tools"
    }
  ],
  "Identity & Authentication": [
    {
      id: 14,
      name: "IAMX",
      logo: "https://iamx.id/logo.svg",
      description: "Decentralized identity management solution for secure, self-sovereign digital identity.",
      fullDescription: "IAMX is a decentralized identity management solution on Cardano. It enables secure, self-sovereign digital identity, allowing users to control their own data and use their wallet for authentication and secure login across different platforms.",
      keySolutions: ["Decentralized ID", "Self-sovereign", "Authentication", "Secure login"],
      website: "https://iamx.id/",
      social: {
        x: "https://x.com/iamx_id"
      },
      category: "Identity & Authentication"
    },
    {
      id: 59,
      name: "Vault3",
      logo: "https://x.com/vault3_io/photo",
      description: "Decentralized identity and authentication platform for Cardano, providing secure digital identity solutions.",
      fullDescription: "Vault3 is a Cardano-based platform focused on decentralized identity and authentication solutions. It provides tools for secure digital identity management, enabling users to control their own data and authenticate securely across different platforms on the Cardano blockchain.",
      keySolutions: ["Decentralized identity", "Authentication", "Digital identity", "Secure login","Token-gateing","NFT-gateing"],
      website: "https://vault3.io/",
      social: {
        github: "https://github.com/vault3-io/vault3",
        x: "https://x.com/vault3_io"
      },
      category: "Identity & Authentication"
    }
  ],
  "Oracles & External Data": [
    {
      id: 16,
      name: "Charli3",
      logo: "https://charli3.io/logo.svg",
      description: "A decentralized oracle network providing reliable off-chain data to Cardano smart contracts.",
      fullDescription: "Charli3 is a decentralized oracle network that provides reliable, tamper-proof off-chain data to smart contracts on the Cardano blockchain. It ensures that dApps have access to accurate real-world data feeds.",
      keySolutions: ["Decentralized oracle", "Off-chain data", "Data feeds", "Reliable"],
      website: "https://charli3.io/",
      social: {
        x: "https://x.com/Charli3_Oracles"
      },
      category: "Oracles & External Data"
    },
    {
      id: 40,
      name: "Orcfax",
      logo: "https://orcfax.io/logo.svg",
      description: "A decentralized oracle platform for Cardano that publishes authentic and auditable real-world data.",
      fullDescription: "Orcfax collects, validates, and publishes fact statements to the Cardano blockchain using archival science principles and ISO standards, solving the oracle problem for smart contracts.",
      keySolutions: ["Decentralized Oracle", "Data Validation", "Fact Statements", "Auditable Data"],
      website: "https://orcfax.io/",
      social: {
        x: "https://x.com/Orcfax"
      },
      category: "Oracles & External Data"
    }
  ],
  "Privacy & Zero-Knowledge": [
    {
      id: 22,
      name: "Midnight Network",
      logo: "https://docs.midnight.network/logo.svg",
      description: "Cardano sidechain focused on privacy-preserving smart contracts using zero-knowledge proofs (ZKPs).",
      fullDescription: "Midnight is a privacy-focused sidechain for Cardano that uses zero-knowledge proofs (ZKPs) to enable confidential smart contracts. It's designed for use cases like privacy-preserving DeFi, secure voting, and private NFTs.",
      keySolutions: ["Privacy-preserving DeFi", "Confidential voting", "Secure identity", "Private NFTs"],
      website: "https://docs.midnight.network/",
      social: {},
      category: "Privacy & Zero-Knowledge"
    },
    {
      id: 42,
      name: "zkFold",
      logo: "https://zkfold.io/wp-content/uploads/2023/09/zkFold-logo.png",
      description: "Layer 1 and Layer 2 DLT zk-rollups scaling solutions for Cardano.",
      fullDescription: "zkFold develops scaling and interoperability solutions using zero-knowledge proofs, including zkFold Symbolic smart contracts and upcoming ZK Rollup.",
      keySolutions: ["ZK-rollups", "Scaling", "Smart contracts", "Zero-knowledge proofs"],
      website: "https://zkfold.io/",
      social: {},
      category: "Privacy & Zero-Knowledge"
    }
  ],
  "AI & Machine Learning": [
    {
      id: 20,
      name: "Masumi Network",
      logo: "https://c-ipfs-gw.nmkr.io/ipfs/QmaFVZvZZqLMvi7MgpdXgWY7PHndBeowjoTsFkGrPphG4Z",
      description: "Groundbreaking blockchain protocol on Cardano enabling the AI Agent Economy with decentralized infrastructure.",
      fullDescription: "Masumi Network is a groundbreaking protocol on Cardano designed to enable the AI Agent Economy. It provides decentralized infrastructure for AI agent transactions, identity management, and discovery.",
      keySolutions: ["AI agent transactions", "Agent-to-agent payments", "Decision logging", "Agent identity", "Agent discovery", "AI agent economy", "Decentralized infrastructure", "On-chain decision logging", "Agentic services", "AI marketplace"],
      website: "https://masumi.network/",
      social: {
        docs: "https://docs.masumi.network/",
        marketplace: "https://www.sokosumi.com/",
        github: "https://github.com/masumi-network",
        x: "https://x.com/masumi_network",
        discord: "https://discord.com/invite/aj4QfnTS92",
        telegram: "https://t.me/masumi_network"
      },
      category: "AI & Machine Learning"
    },
    {
      id: 21,
      name: "Kodosumi",
      logo: "https://c-ipfs-gw.nmkr.io/ipfs/QmVhGs1DhzPCZZ4P1ex5ssePhTDXiCEnFGHcwBVt5kB2e7",
      description: "Runtime environment to manage and execute agentic services at scale using Ray distributed computing framework.",
      fullDescription: "Kodosumi provides a runtime environment for managing and executing AI agentic services at scale. It leverages the Ray distributed computing framework and is designed with a Python-first approach for seamless integration. It is a part of the Masumi Network ecosystem.",
      keySolutions: ["Agentic services", "Distributed computing", "Python-first", "Ray framework", "AI agentic services", "AI agentic economy", "AI agentic infrastructure", "AI agentic marketplace", "AI agentic identity", "AI agentic discovery"],
      website: "https://kodosumi.io/",
      social: {
        docs: "https://docs.kodosumi.io/",
        github: "https://github.com/masumi-network/kodosumi",
        x: "https://x.com/masumi_network",
        discord: "https://discord.com/invite/aj4QfnTS92",
        telegram: "https://t.me/masumi_network"
      },
      category: "AI & Machine Learning"
    },
    {
      id: 22,
      name: "Sokosumi",
      logo: "https://c-ipfs-gw.nmkr.io/ipfs/QmUqHkovUfQ4zM9GyVsMFuC1Mps9xeqDMpLMPBtttFyL32",
      description: "AI-powered research and analysis platform built on the Masumi Network, providing comprehensive tools for all kinds of research.",
      fullDescription: "Sokosumi is an AI-powered research and analysis platform that leverages the Masumi Network infrastructure. It provides comprehensive tools for various types of research, enabling users to conduct thorough analysis and gather insights using advanced AI capabilities. If you are building an AI agentic service, Sokosumi is where you want to deploy it.",
      keySolutions: ["AI research tools", "Data analysis", "Research platform", "AI-powered insights", "Masumi Network integration", "Comprehensive research", "AI analysis tools"],
      website: "https://www.sokosumi.com/",
      social: {
        github: "https://github.com/masumi-network",
        docs: "https://docs.masumi.network/",
        x: "https://x.com/masumi_network",
        discord: "https://discord.com/invite/aj4QfnTS92",
        telegram: "https://t.me/masumi_network"
      },
      category: "AI & Machine Learning"
    }
  ],
  "Development Platforms": [
    {
      id: 12,
      name: "Demeter",
      logo: "https://docs.demeter.run/images/logo-dark.svg",
      description: "Cardano development platform offering infrastructure for dApp deployment, including APIs, hosting, and storage.",
      fullDescription: "Demeter is an all-in-one development platform for Cardano that offers ready-to-use infrastructure for dApp deployment. It provides APIs, hosting, and storage solutions, allowing developers to focus on building without managing their own nodes.",
      keySolutions: ["dApp deployment", "API hosting", "Storage solutions", "Smart contract management"],
      website: "https://demeter.run/",
      social: {
        github: "https://github.com/demeter-run"
      },
      category: "Development Platforms"
    },
    {
      id: 13,
      name: "TxPipe Developer Tools",
      logo: "https://txpipe.io/logo.svg",
      description: "Open-source tools like Dolos, Oura, Scrolls, and Pallas for custom data pipelines and off-chain integration.",
      fullDescription: "TxPipe offers a suite of open-source tools like Dolos, Oura, Scrolls, and Pallas. These tools empower developers to build custom data pipelines, stream real-time data, and create custom backends for off-chain integration.",
      keySolutions: ["Data pipelines", "Stream processing", "Custom backends", "Real-time data"],
      website: "https://txpipe.io/#developer-tools",
      social: {
        github: "https://github.com/txpipe"
      },
      category: "Development Platforms"
    },
    {
      id: "[next available id]",
      name: "KuberIDE",
      logo: "https://dquadrant.com/wp-content/uploads/2024/07/Dquadrant-Small-logo-white-orange.webp",
      description: "KuberIDE Plutus/Haskell based smart contract development platform",
      fullDescription: "Web-based development environment similar like Remix to build, test and deploy smart contracts",
      keySolutions: [ "Blockchain integration", "Wallet integration", "Network integration", "Hydra integration", "Transaction management" ],
      website: "https://kuberide.com",
      social: {
        github: "https://github.com/dQuadrant/kuber-playground"
      },
      docs: "https://github.com/dQuadrant/kuber-playground/#readme", 
      category: "Development Platforms"
    }
  ],
  "Community & Engagement": [
    {
      id: 18,
      name: "Vibrant",
      logo: "https://www.vibrantnet.io/logo.svg",
      description: "Discord bot and blockchain service for community engagement, supporting token-based rewards and role management.",
      fullDescription: "Vibrant is a community engagement platform that uses a Discord bot and blockchain services to support token-based rewards and role management. It's designed to help projects foster active and engaged communities.",
      keySolutions: ["Community rewards", "Discord integration", "Role management", "Token rewards"],
      website: "https://www.vibrantnet.io/",
      social: {},
      category: "Community & Engagement"
    }
  ],
  "Core Infrastructure": [
    {
      id: 23,
      name: "Cardano Node",
      logo: "https://github.com/input-output-hk/cardano-node/raw/main/doc/images/cardano-logo.svg",
      description: "Core software for running a Cardano node, enabling direct blockchain interaction for advanced users.",
      fullDescription: "Cardano Node is the core software component that powers the Cardano network. Running a node enables direct interaction with the blockchain, allowing advanced users to build custom validators, monitor the network, and access the chain directly.",
      keySolutions: ["Custom validators", "Network monitoring", "Full node services", "Direct blockchain access"],
      website: "https://github.com/input-output-hk/cardano-node",
      social: {
        github: "https://github.com/input-output-hk/cardano-node"
      },
      category: "Core Infrastructure"
    },
    {
      id: 24,
      name: "Ogmios",
      logo: "https://ogmios.dev/logo.svg",
      description: "Lightweight WebSocket API for Cardano node interaction, providing real-time data access and chain synchronization.",
      fullDescription: "Ogmios is a lightweight WebSocket API that provides a simple way to interact with a Cardano node. It's designed for real-time data access and chain synchronization, making it an ideal backend component for dApps.",
      keySolutions: ["Real-time data", "WebSocket API", "Chain sync", "Lightweight backend"],
      website: "https://ogmios.dev/",
      social: {
        github: "https://github.com/CardanoSolutions/ogmios"
      },
      category: "Core Infrastructure"
    }
  ],
  "Layer 2 Scaling Solutions": [
    {
      id: 44,
      name: "Hydra",
      logo: "https://hydra.family/assets/images/hydra-logo.svg",
      description: "Layer 2 scaling solution for Cardano using state channels to increase transaction throughput and reduce latency.",
      fullDescription: "Hydra is a family of protocols providing isomorphic multi-party state channels on Cardano for high scalability and low-cost transactions.",
      keySolutions: ["State Channels", "Scalability", "Low Latency", "High Throughput"],
      website: "https://hydra.family/head-protocol/",
      social: {
        github: "https://github.com/input-output-hk/hydra"
      },
      category: "Layer 2 Scaling Solutions"
    },
    {
      id: 45,
      name: "Midgard",
      logo: "https://anastasialabs.com/assets/logo.svg",
      description: "Cardano-native optimistic rollup for scalable transaction processing with deterministic fraud proofs.",
      fullDescription: "Midgard, developed by Anastasia Labs, is an optimistic rollup Layer 2 solution tailored for Cardano, offering minimal reliance on centralized governance and efficient scaling.",
      keySolutions: ["Optimistic Rollup", "Fraud Proofs", "Scaling", "Decentralized"],
      website: "https://anastasialabs.com/",
      social: {},
      category: "Layer 2 Scaling Solutions"
    },
    {
      id: 46,
      name: "Gummiworm",
      logo: "https://sundae.fi/assets/logo.svg",
      description: "Infinitely scalable Layer 2 solution built on Hydra for fast, cheap transactions on Cardano.",
      fullDescription: "Gummiworm by Sundae Labs utilizes Hydra to provide millisecond transactions and low fees, enabling scalable DeFi on Cardano.",
      keySolutions: ["Hydra-based", "Infinite Scalability", "Low Fees", "Fast Transactions"],
      website: "https://sundae.fi/products/gummiworm",
      social: {},
      category: "Layer 2 Scaling Solutions"
    }
  ],
  "Governance & DAOs": [
    {
      id: 47,
      name: "Sundae Governance",
      logo: "https://sundae.fi/assets/logo.svg",
      description: "Secure, off-chain voting solution for DAOs on Cardano with zero fees and cryptographic proofs.",
      fullDescription: "Sundae Governance is a platform for decentralized voting, enabling DAOs to conduct secure, cost-effective governance.",
      keySolutions: ["DAO Voting", "Zero Fees", "Cryptographic Proofs", "Secure Governance"],
      website: "https://sundae.fi/products/governance",
      social: {},
      category: "Governance & DAOs"
    }
  ]
}; 
