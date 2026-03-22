// Rode este script dentro de executor_scripts.html
// Contexto esperado: db, log, collection, getDocs, writeBatch

(async () => {
    log("Buscando produtos com desconto ativo...", "info");

    const snapshot = await getDocs(collection(db, "pecas"));
    let atualizados = 0;
    let operacoesNoBatch = 0;
    let batch = writeBatch(db);

    for (const productDoc of snapshot.docs) {
        const data = productDoc.data();
        const descontoAtual = Number(data?.desconto || 0);

        if (descontoAtual <= 0) {
            continue;
        }

        batch.update(productDoc.ref, { desconto: 0 });
        operacoesNoBatch += 1;
        atualizados += 1;
        log(`Removendo desconto de ${data?.nome || productDoc.id} (${descontoAtual}%).`, "warning");

        if (operacoesNoBatch >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            operacoesNoBatch = 0;
        }
    }

    if (operacoesNoBatch > 0) {
        await batch.commit();
    }

    if (atualizados === 0) {
        log("Nenhum produto com desconto ativo foi encontrado.", "success");
        return;
    }

    log(`${atualizados} produto(s) tiveram o desconto zerado.`, "success");
})();
