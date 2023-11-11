import { BitcoinAccount, Snap } from "../interface";
import { AccountSigner, BtcTx } from "../bitcoin";
import { getNetwork } from "../bitcoin/getNetwork";
import { SnapError, RequestErrors } from "../errors";
import { heading, panel, text, divider } from "@metamask/snaps-ui";
import { extractAccountPrivateKeyByPath } from "../utils/account";
import { getCurrentNetwork } from "./network";
import { getAccounts } from "./account";
import { Signer, crypto } from "bitcoinjs-lib";

const toXOnly = (pubKey: Buffer) =>
  pubKey.length === 32 ? pubKey : pubKey.slice(1, 33);

export async function signPsbt(
  origin: string,
  snap: Snap,
  psbt: string,
  signerAddresses: string[]
): Promise<{ txId: string; txHex: string }> {
  const snapNetwork = await getCurrentNetwork(snap);

  const btcTx = new BtcTx(psbt, snapNetwork, signerAddresses);
  const txDetails = btcTx.extractPsbtJson();

  const accounts = await getAccounts(snap);
  const signers: Signer[] = [];
  for (const signerAddress of signerAddresses) {
    const signer = accounts.find(
      (account) => account.address === signerAddress
    );
    if (signer) {
      const accountPrivateKey = await extractAccountPrivateKeyByPath(
        snap,
        getNetwork(snapNetwork),
        signer.derivationPath
      );

      if (signer.derivationPath[1] === "86'") {
        const tweakedChildNode = accountPrivateKey.tweak(
          crypto.taggedHash("TapTweak", toXOnly(accountPrivateKey.publicKey))
        );
        signers.push(tweakedChildNode);
      } else {
        signers.push(new AccountSigner(accountPrivateKey));
      }
    } else {
      throw SnapError.of(RequestErrors.AccountNotExisted);
    }
  }

  const result = await snap.request({
    method: "snap_dialog",
    params: {
      type: "confirmation",
      content: panel([
        heading("Sign Bitcoin Transaction"),
        text(`Please verify this ongoing Transaction from ${origin}`),
        divider(),
        panel(
          Object.entries(txDetails).map(([key, value]) =>
            text(`**${key}**:\n ${value}`)
          )
        ),
      ]),
    },
  });

  if (result) {
    btcTx.validateTx();
    return btcTx.signTx(signers);
  } else {
    throw SnapError.of(RequestErrors.RejectSign);
  }
}
